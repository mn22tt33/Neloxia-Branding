(function () {
  "use strict";

  var appConfig = window.APP_CONFIG || {};
  var apiBaseUrl = "https://slouchy-grappling-stingily.ngrok-free.dev";
  var hostname = location.hostname.toLowerCase();
  var isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(hostname);
  var isQuickTunnel = /^[a-z0-9-]+\.trycloudflare\.com$/i.test(hostname);

  appConfig.apiBaseUrl =
    isLocalHost || isQuickTunnel || location.origin === apiBaseUrl
      ? ""
      : apiBaseUrl;
  appConfig.backendMode = "local";
  window.APP_CONFIG = appConfig;
})();
