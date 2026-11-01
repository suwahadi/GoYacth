package app

import (
	"github.com/riverqueue/river"

	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/cms"
	"goyacht/internal/modules/media"
	"goyacht/internal/modules/settings"
	"goyacht/internal/modules/users"
)

func registerFeatureModules(d *Deps, m *Modules, mediaSvc *media.Service) {
	usersH := users.NewHandler(d.Pool)
	settingsH := settings.NewHandler(d.Pool)
	masterH := catalog.NewMasterHandler(d.Pool)
	locationH := catalog.NewLocationHandler(d.Pool, mediaSvc, d.Store)
	boatH := catalog.NewBoatHandler(d.Pool, mediaSvc, d.Store)
	cmsH := cms.NewHandler(d.Pool, mediaSvc, d.Store, cms.HomeExtras{})

	m.Public = append(m.Public, settingsH.PublicRoutes, masterH.PublicRoutes, locationH.PublicRoutes, boatH.PublicRoutes, cmsH.PublicRoutes)
	m.Customer = append(m.Customer, usersH.CustomerRoutes)
	m.Admin = append(m.Admin, usersH.AdminRoutes, settingsH.AdminRoutes, masterH.AdminRoutes, locationH.AdminRoutes, boatH.AdminRoutes, cmsH.AdminRoutes)
}

func registerFeatureWorkers(d *Deps, workers *river.Workers, mediaSvc *media.Service) []*river.PeriodicJob {
	return nil
}
