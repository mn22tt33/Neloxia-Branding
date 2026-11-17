window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.apiBaseUrl = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? ""
  : "https://quizora55.up.railway.app";
