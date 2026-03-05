type MaybeResponse = Response | null;

type RouteHandler = (req: Request, url: URL) => Promise<MaybeResponse>;
type RouteHandlerWithServer<TServer> = (
  req: Request,
  url: URL,
  server: TServer,
) => Promise<MaybeResponse>;
type RouteHandlerWithServerDeps<TServer, TDeps> = (
  req: Request,
  url: URL,
  server: TServer,
  deps: TDeps,
) => Promise<MaybeResponse>;
type RouteHandlerWithDeps<TDeps> = (
  req: Request,
  url: URL,
  deps: TDeps,
) => Promise<MaybeResponse>;

type HttpDispatchDeps<
  TServer,
  TNotificationsConfig,
  TBuild,
  TDeploy,
  TFileDownload,
  TPlugin,
  TMisc,
  TAssets,
  TPage,
  TClient,
  TWsUpgrade,
> = {
  metrics: { withHttpMetrics: (fn: () => Promise<Response>) => Promise<Response> };
  CORS_HEADERS: Record<string, string>;
  handleAuthRoutes: RouteHandlerWithServer<TServer>;
  handleNotificationsConfigRoutes: RouteHandlerWithServerDeps<TServer, TNotificationsConfig>;
  handleAutoScriptsRoutes: RouteHandler;
  handleUsersRoutes: RouteHandlerWithServer<TServer>;
  handleBuildRoutes: RouteHandlerWithServerDeps<TServer, TBuild>;
  handleDeployRoutes: RouteHandlerWithServerDeps<TServer, TDeploy>;
  handleFileDownloadRoutes: RouteHandlerWithServerDeps<TServer, TFileDownload>;
  handlePluginRoutes: RouteHandlerWithDeps<TPlugin>;
  handleMiscRoutes: RouteHandlerWithDeps<TMisc>;
  handleAssetsRoutes: RouteHandlerWithDeps<TAssets>;
  handlePageRoutes: RouteHandlerWithDeps<TPage>;
  handleClientRoutes: RouteHandlerWithServerDeps<TServer, TClient>;
  handleWsUpgradeRoutes: RouteHandlerWithServerDeps<TServer, TWsUpgrade>;
  routeDeps: {
    notificationsConfig: TNotificationsConfig;
    build: TBuild;
    deploy: TDeploy;
    fileDownload: TFileDownload;
    plugin: TPlugin;
    misc: TMisc;
    assets: TAssets;
    page: TPage;
    client: TClient;
    wsUpgrade: TWsUpgrade;
  };
};

export function createHttpFetchHandler<
  TServer,
  TNotificationsConfig,
  TBuild,
  TDeploy,
  TFileDownload,
  TPlugin,
  TMisc,
  TAssets,
  TPage,
  TClient,
  TWsUpgrade,
>(
  deps: HttpDispatchDeps<
    TServer,
    TNotificationsConfig,
    TBuild,
    TDeploy,
    TFileDownload,
    TPlugin,
    TMisc,
    TAssets,
    TPage,
    TClient,
    TWsUpgrade
  >,
) {
  return async function fetchHandler(req: Request, server: unknown): Promise<Response> {
    return deps.metrics.withHttpMetrics(async () => {
      const routeServer = server as TServer;
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response("", { headers: deps.CORS_HEADERS });
      }

      const authRouteResponse = await deps.handleAuthRoutes(req, url, routeServer);
      if (authRouteResponse) return authRouteResponse;

      const notificationsConfigResponse = await deps.handleNotificationsConfigRoutes(req, url, routeServer, deps.routeDeps.notificationsConfig);
      if (notificationsConfigResponse) return notificationsConfigResponse;

      const autoScriptsResponse = await deps.handleAutoScriptsRoutes(req, url);
      if (autoScriptsResponse) return autoScriptsResponse;

      const usersResponse = await deps.handleUsersRoutes(req, url, routeServer);
      if (usersResponse) return usersResponse;

      const buildResponse = await deps.handleBuildRoutes(req, url, routeServer, deps.routeDeps.build);
      if (buildResponse) return buildResponse;

      const deployResponse = await deps.handleDeployRoutes(req, url, routeServer, deps.routeDeps.deploy);
      if (deployResponse) return deployResponse;

      const fileDownloadResponse = await deps.handleFileDownloadRoutes(req, url, routeServer, deps.routeDeps.fileDownload);
      if (fileDownloadResponse) return fileDownloadResponse;

      const pluginResponse = await deps.handlePluginRoutes(req, url, deps.routeDeps.plugin);
      if (pluginResponse) return pluginResponse;

      const miscResponse = await deps.handleMiscRoutes(req, url, deps.routeDeps.misc);
      if (miscResponse) return miscResponse;

      const assetsResponse = await deps.handleAssetsRoutes(req, url, deps.routeDeps.assets);
      if (assetsResponse) return assetsResponse;

      const pageResponse = await deps.handlePageRoutes(req, url, deps.routeDeps.page);
      if (pageResponse) return pageResponse;

      const clientRouteResponse = await deps.handleClientRoutes(req, url, routeServer, deps.routeDeps.client);
      if (clientRouteResponse) return clientRouteResponse;

      const wsUpgradeResponse = await deps.handleWsUpgradeRoutes(req, url, routeServer, deps.routeDeps.wsUpgrade);
      if (wsUpgradeResponse) return wsUpgradeResponse;

      return new Response("Not found", { status: 404 });
    });
  };
}
