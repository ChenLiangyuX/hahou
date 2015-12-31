var system = require('system');

module.exports = function waitFor( page, selector, expiry, callback ) {
  // system.stderr.writeLine( "- waitFor( " + selector + ", " + expiry + " )" );

  // try and fetch the desired element from the page
  var result = page.evaluate(
    function (selector) {
      return document.querySelector( selector );
    }, selector
  );

  // if desired element found then call callback after 50ms
  if ( result ) {
    // system.stderr.writeLine( "- trigger " + selector + " found" );
    window.setTimeout(
      function () {
        callback( true );
      },
      50
    );
    return;
  }

  // determine whether timeout is triggered
  var finish = (new Date()).getTime();
  if ( finish > expiry ) {
    // system.stderr.writeLine( "- timed out" );
    callback( false );
    return;
  }

  // haven't timed out, haven't found object, so poll in another 100ms
  window.setTimeout(
    function () {
      waitFor( page, selector, expiry, callback );
    },
    100
  );
};
