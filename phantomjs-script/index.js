var fs = require('fs');
var webPage = require('webpage');
var page = webPage.create();
var waitFor = require('./lib/waitFor');
var Promise = require('es6-promise').Promise;
var system = require('system');
var md5 = require('md5');
var querystring = require('querystring');
var config = require('../config');
var args = system.args;
var cityName, keyword, previewPage;

if (args.length < 3) {
  system.stderr.writeLine('脚本参数错误，至少传入地区和关键词');
  safePhantomExit(1)
} else {
  cityName = args[1];
  keyword = args[2];
  previewPage = args[3];

  if (cityName === '') {
    system.stderr.writeLine('缺少城市名称参数');
    safePhantomExit(1);
  }

  if (keyword === '') {
    system.stderr.writeLine('缺少关键词参数');
    safePhantomExit(1);
  }

  if (previewPage) {
    if (!/-?[1-9]\d*|0/.test(previewPage)) {
      system.stderr.writeLine('页数只能是数字');
      safePhantomExit(1);
    } else if ((previewPage <= 0 || previewPage > 76)) {
      system.stderr.writeLine('页数只能在1-76之间');
      safePhantomExit(1);
    }
  } else {
    previewPage = 1;
  }
}

if (fs.exists('./.tmp/cookie.json')) {
  require('../.tmp/cookie').forEach(function (element) {
    phantom.addCookie(element);
  });
}

page.onError = function() {};
page.onCallback = function(args){
  if (args.next) {
    steps.splice(0, args.next);
    if (steps[0]) {
      steps[0].call(this, args.nextArgs);
    }
  }

  if (args.html) {
    var fileNme = 'preview' + md5(Math.random()) + '.html';
    var filePath =  './.tmp/' + fileNme;
    fs.write(filePath, args.html, 'w');
    system.stdout.writeLine(filePath);
    safePhantomExit(0);
  }

  if (args.errorExit) {
    system.stderr.writeLine(args.errorExit);
    safePhantomExit(1);
  }
};

page.open('http://fengchao.baidu.com/nirvana/main.html#/manage/plan~openTools=adpreview', function() {
  steps[0]();
});

function pageListener(selector, timeout) {
  var expiry = (new Date()).getTime() + timeout;
  return new Promise(function (resolve, reject) {
    waitFor(page, selector, expiry, function (status) {
      if ( status ) {
        resolve();
      } else {
        reject();
      }
    });
  });
}
/**
 * Exit phantom instance "safely" see - https://github.com/ariya/phantomjs/issues/12697
 * A tiny bit of a hack.
 */
function safePhantomExit(code) {
  if (page) page.close();
  setTimeout(function(){ phantom.exit(code); }, 0);
  phantom.onError = function(){};
  throw new Error('');
}

var steps = [
  /**
   * 查看是否是直接在登录页面，并向api请求识别验证码
   */
  function() {
    pageListener("#uc-login", 5000).then(function() {
      page.clipRect = page.evaluate(function() {
        var $img = $('#token-img');
        return {
          top : $img.offset().top,
          left : $img.offset().left,
          width : $img.width(),
          height : $img.height()
        }
      });

      // 写入验证码到文件
      page.render('./.tmp/code.png');
      page.clipRect = { left:0, top:0, width:0, height:0 };

      // 准备一个新的页面，做向api发送请求验证
      var newPage = webPage.create();
      newPage.onCallback = page.onCallback;
      newPage.evaluate(function(config) {
        config = JSON.parse(config);
        var formTemplate = [
          '<form action="http://upload.chaojiying.net/Upload/Processing.php" method="post" enctype="multipart/form-data">',
            '<input type="hidden" name="user" value="'+ config.user +'">',
            '<input type="hidden" name="pass" value="'+ config.pass +'">',
            '<input type="hidden" name="softid" value="'+ config.softid +'">',
            '<input type="hidden" name="codetype" value="'+ config.codetype +'">',
            '<input type="file" name="userfile">',
          '</form>'
        ].join('\n');
        $wrap = document.createElement('div');
        $wrap.innerHTML = formTemplate;
        document.body.appendChild($wrap);
      }, JSON.stringify(config.chaojiying));

      newPage.uploadFile('input[name=userfile]', './.tmp/code.png');
      newPage.evaluate(function() {
        document.querySelector('form').submit();
      });

      newPage.onUrlChanged = function(targetUrl) {
        //删除临时验证码文件
        fs.remove('./.tmp/code.png');
        if (targetUrl === 'http://upload.chaojiying.net/Upload/Processing.php') {
          var startTime = (new Date()).getTime();
          var timeOut = 30000;
          var finishTime = startTime + timeOut;
          var timer = setInterval(function() {
            if ((new Date()).getTime() > finishTime) {
              system.stderr.writeLine('请求识别验证码超时');
              safePhantomExit(1);
            }
            try {
              var res = JSON.parse(/<body>(.*?)<\/body>/g.exec(newPage.content)[1]);
            } catch (e) {}

            if (res) {
              if (res.pic_str) {
                newPage.onCallback({next: 1, nextArgs:{code: res.pic_str}});
                newPage.close();
              } else {
                system.stderr.writeLine('请求识别验证码错误：' + res.err_str);
                safePhantomExit(1);
              }
              clearInterval(timer);
            }
          }, 50);
        }
      };

    }, function() {
      // 直接跳到查找搜索按钮
      page.onCallback({next: 2});
    }).catch(function() {
      system.stderr.writeLine('请求识别验证码发生错误');
      safePhantomExit(1);
    });
  },

  /**
   * 填写用户名密码验证码并提交
   */
  function(nextArgs) {
    var code = nextArgs.code;
    page.evaluate(function(code, config) {
      config = JSON.parse(config);
      $('#uc-common-account').val(config.user);
      $('#ucsl-password-edit').val(config.pass);
      $('#uc-common-token').val(code);
      $('#uc-login').submit();
    }, code, JSON.stringify(config.baidu));

    var timer = setTimeout(function() {
      page.evaluate(function() {
        var message = $('#token-error').text();
        if (message === '验证码错误') {
          // 验证码错误向超级鹰提交打下，报错反分

          window.callPhantom({errorExit: '验证码错误向超级鹰提交打下'});
        } else {
          window.callPhantom({errorExit: message});
        }
      });
    }, 10000);
    page.onUrlChanged = function(targetUrl) {
      if (targetUrl.indexOf('https://tuiguang.baidu.com/home.html' >= 0)) {
        clearInterval(timer);
        // 这里应该表示登陆成功了，需要保存下cookie
        fs.write('./.tmp/cookie.json', JSON.stringify(page.cookies));
        page.onCallback({next: 1});
      }
    };
  },

  /**
   * 查找搜索按钮并选择关键词而城市
   */
  function() {
    pageListener("#ctrlbuttonAdPreviewSearchBtn", 30000).then(function() {
      page.evaluate(function(cityName, keyword) {
        var provinces = document.querySelectorAll('#ctrlselectAdpreviewRegionSelectorlayer > div');
        var clickEvent = document.createEvent('Event');
        var mousemoveEvent = document.createEvent('Event');
        var isFind = false;
        clickEvent.initEvent('click', true, true);
        mousemoveEvent.initEvent('mousemove', true, true);
        // 选择城市
        Array.prototype.forEach.call(provinces, function(ele) {
          if (ele.innerText === cityName) {
            ele.dispatchEvent(clickEvent);
            isFind = true;
          } else {
            ele.dispatchEvent(mousemoveEvent);
            var cities = document.querySelectorAll('#ctrlselectAdpreviewRegionSelector ul.region-list > li');
            Array.prototype.forEach.call(cities, function(ele) {
              if (ele.innerText === cityName) {
                ele.dispatchEvent(clickEvent);
                isFind = true;
              }
            });
          }
        });

        if (!isFind) {
          window.callPhantom({errorExit: '没有找到此城市'});
        }

        document.querySelector('#ctrltextAdpreviewKeyword').value = keyword;
        document.querySelector('#ctrlbuttonAdPreviewSearchBtn').dispatchEvent(clickEvent);
        window.callPhantom({next: 1});
      }, cityName, keyword);
    }, function() {
      system.stderr.writeLine('没有找到搜索按钮');
      safePhantomExit(1);
    }).catch(function() {
      system.stderr.writeLine('查找搜索按钮发生错误');
      safePhantomExit(1);
    });
  },

  /**
   * 查找iframe
   */
  function() {
    pageListener("#adpreview-frame-pc", 5000).then(function() {
      page.evaluate(function() {
        window.callPhantom({next: 1});
      });
    }, function() {
      system.stderr.writeLine('没有找到iframe');
      safePhantomExit(1);
    }).catch(function() {
      system.stderr.writeLine('查找iframe发生错误');
      safePhantomExit(1);
    });
  },

  /**
   * 切换进iframe查找foot
   */
  function() {
    page.switchToFrame('adpreview-frame-pc');
    pageListener('#foot', 15000).then(function () {
      if (previewPage > 1) {
        page.switchToParentFrame();
        page.evaluate(function(previewPage) {
          var contentWindow = document.querySelector('#adpreview-frame-pc').contentWindow;
          var contentBottom = contentWindow.document.querySelector('#content_bottom');
          contentBottom.parentNode.removeChild(contentBottom);
          window.switchPage((previewPage - 1) * 10);
          window.callPhantom({next: 1});
        }, previewPage);
      } else {
        page.evaluate(function() {
          window.parent.callPhantom({html: document.documentElement.outerHTML});
        });
      }
    }, function () {
      system.stderr.writeLine('在iframe中没有找到foot');
      safePhantomExit(1);
    }).catch(function () {
      system.stderr.writeLine('查找foot发生错误');
      safePhantomExit(1);
    });
  },

  /**
   * 翻页继续查找foot发生
   */
  function() {
    page.switchToFrame('adpreview-frame-pc');
    pageListener('#foot', 15000).then(function () {
      page.evaluate(function() {
        window.parent.callPhantom({html: document.documentElement.outerHTML});
      });
    }, function () {
      system.stderr.writeLine('翻页在iframe中没有找到foot');
      safePhantomExit(1);
    }).catch(function () {
      system.stderr.writeLine('翻页查找foot发生错误');
      safePhantomExit(1);
    });
  }
];
