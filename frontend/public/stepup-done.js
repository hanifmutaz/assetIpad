(function () {
  var ok = /[?&]ok=1/.test(location.search);
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'ipad-stepup', ok: ok }, location.origin);
    setTimeout(function () { window.close(); }, 300);
  } else {
    location.replace('/');
  }
})();
