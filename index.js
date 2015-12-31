// liuning@baixing.com

var path = require('path');
var childProcess = require('child_process');
var phantomjs = require('phantomjs');
var fs = require('fs');
var binPath = phantomjs.path;
var cityName = '温州';
var keyword = '天鹅湖';
var previewPage = '1';
var childArgs = [
  path.join(__dirname, './phantomjs-script/index.js'),
  cityName,
  keyword,
  previewPage
];

childProcess.execFile(binPath, childArgs, function(err, stdout, stderr) {
  if (stderr) {
    var message = stderr.trim();
    console.log(message);
  } else if (stdout) {
    var filePath = stdout.trim();
    fs.readFile(filePath, function(err, data) {
      if (err) throw err;
      fs.writeFile('test.html', data.toString());
      fs.unlink(filePath);
    });
  }
});
