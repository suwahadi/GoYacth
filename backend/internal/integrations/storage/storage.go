package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Bucket string

const (
	Public  Bucket = "PUBLIC"
	Private Bucket = "PRIVATE"
)

type Store interface {
	Put(ctx context.Context, b Bucket, key string, data []byte, contentType string) error
	Delete(ctx context.Context, b Bucket, key string) error
	Get(ctx context.Context, b Bucket, key string) ([]byte, error)
	PresignGet(ctx context.Context, b Bucket, key string, ttl time.Duration) (string, error)
	PublicURL(key string) string
}

type S3 struct {
	client        *minio.Client
	publicBucket  string
	privateBucket string
	publicBaseURL string
}

type Options struct {
	Endpoint, Region, AccessKey, SecretKey string
	UseSSL                                 bool
	PublicBucket, PrivateBucket            string
	PublicBaseURL                          string
}

func NewS3(o Options) (*S3, error) {
	c, err := minio.New(o.Endpoint, &minio.Options{
		Creds: credentials.NewStaticV4(o.AccessKey, o.SecretKey, ""), Secure: o.UseSSL, Region: o.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}
	return &S3{client: c, publicBucket: o.PublicBucket, privateBucket: o.PrivateBucket, publicBaseURL: o.PublicBaseURL}, nil
}

func (s *S3) bucket(b Bucket) string {
	if b == Public {
		return s.publicBucket
	}
	return s.privateBucket
}

// EnsureBuckets creates both buckets and grants anonymous read on the public one only.
func (s *S3) EnsureBuckets(ctx context.Context) error {
	for _, name := range []string{s.publicBucket, s.privateBucket} {
		exists, err := s.client.BucketExists(ctx, name)
		if err != nil {
			return fmt.Errorf("check bucket %s: %w", name, err)
		}
		if !exists {
			if err := s.client.MakeBucket(ctx, name, minio.MakeBucketOptions{}); err != nil {
				return fmt.Errorf("create bucket %s: %w", name, err)
			}
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, s.publicBucket)
	return s.client.SetBucketPolicy(ctx, s.publicBucket, policy)
}

func (s *S3) Put(ctx context.Context, b Bucket, key string, data []byte, contentType string) error {
	opts := minio.PutObjectOptions{ContentType: contentType}
	if b == Public {
		opts.CacheControl = "public, max-age=31536000, immutable"
	} else {
		opts.CacheControl = "private, no-store"
	}
	_, err := s.client.PutObject(ctx, s.bucket(b), key, bytes.NewReader(data), int64(len(data)), opts)
	return err
}

func (s *S3) Delete(ctx context.Context, b Bucket, key string) error {
	return s.client.RemoveObject(ctx, s.bucket(b), key, minio.RemoveObjectOptions{})
}

func (s *S3) Get(ctx context.Context, b Bucket, key string) ([]byte, error) {
	obj, err := s.client.GetObject(ctx, s.bucket(b), key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(obj); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *S3) PresignGet(ctx context.Context, b Bucket, key string, ttl time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket(b), key, ttl, url.Values{})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func (s *S3) PublicURL(key string) string {
	return s.publicBaseURL + "/" + key
}
