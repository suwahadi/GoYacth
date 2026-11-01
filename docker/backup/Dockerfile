FROM postgres:18.6-alpine
RUN apk add --no-cache rclone tzdata
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh && mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
