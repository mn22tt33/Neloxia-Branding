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
  appConfig.firebase = {
    apiKey: "AIzaSyCg2xh6IwR8WpYSX3S7EZosCB351rWyYSg",
    authDomain: "quizora-auth-105be.firebaseapp.com",
    projectId: "quizora-auth-105be",
    storageBucket: "quizora-auth-105be.firebasestorage.app",
    messagingSenderId: "800691791403",
    appId: "1:800691791403:web:1f20c461ab12459d226c6e"
  };
  window.APP_CONFIG = appConfig;
})();
