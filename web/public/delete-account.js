// delete-account.js: the Delete account web page (delete-account.html), which Google Play asks
// for, so an account can be deleted without the app. The number is proved with WhatsApp, like
// signing in: start a check (purpose "delete"), the person sends the code, then its secret
// deletes the account on that number (POST /api/account/delete). Its own file, because the
// website only runs scripts from its own files (Content-Security-Policy).
(function () {
  'use strict';

  var words = {
    en: {
      title: 'Delete your PakChat account',
      inAppTitle: 'In the app (the quickest way)',
      inAppText: 'Open PakChat on your phone, then go to Settings › Account › Delete my account, and type your phone number.',
      whatTitle: 'What gets deleted',
      what1: 'Your account: your name, photo, about, phone number and Gmail.',
      what2: 'Your chat backup on our server, your devices and their keys.',
      what3: 'You leave all your groups and communities.',
      what4: 'Messages and files still waiting to be delivered to you.',
      whatKept: 'Messages you already sent stay on the phones of the people who got them, as with any messaging app. Photos and files you already sent stay for them until their usual 30 days are up, and a group photo you set stays with the group. Our nightly safety copies of the server are deleted within 14 days.',
      webTitle: 'No app? Delete it here',
      phoneLabel: 'Your PakChat phone number',
      phoneHint: "We check the number is yours with WhatsApp, the same way PakChat signs you in. It's free.",
      next: 'Next',
      wa1: 'Tap Open WhatsApp. It opens with a short message to PakChat.',
      wa2: 'Press Send. Send it from the WhatsApp on the number you typed.',
      wa3: 'Come back to this page. It carries on by itself.',
      openWa: 'Open WhatsApp',
      waiting: 'Waiting for your message…',
      back: 'Change the number',
      cantUndo: "This can't be undone.",
      deleteBtn: 'Delete my account',
      gmailTitle: 'Signed in only with Gmail?',
      gmailText: "Delete it in the app (Settings › Account › Delete my account), or email us from that Gmail and we'll delete it within 30 days:",
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      confirm: 'Delete the PakChat account on {phone}?',
      deleting: 'Deleting…',
      done: 'Done. The PakChat account on {phone} was deleted.',
      noAccount: 'No PakChat account uses {phone}. There is nothing to delete.',
      badPhone: "That doesn't look like a phone number. Check it and try again.",
      wrongFrom: 'That message came from {from}, not {phone}. Send it from the WhatsApp on {phone}.',
      expired: 'The code ran out. Tap Change the number and try again.',
      tooMany: 'Too many tries. Wait a few minutes and try again.',
      off: "This isn't available right now. Delete it in the app, or email us.",
      offline: "Can't reach PakChat. Check your internet and try again.",
      failed: "That didn't work. Start again with your number.",
      other: 'English',
    },
    ur: {
      title: 'اپنا پاک چیٹ اکاؤنٹ ڈیلیٹ کریں',
      inAppTitle: 'ایپ میں (سب سے آسان طریقہ)',
      inAppText: 'اپنے فون پر پاک چیٹ کھولیں، پھر سیٹنگز › اکاؤنٹ › میرا اکاؤنٹ ڈیلیٹ کریں پر جائیں، اور اپنا فون نمبر لکھیں۔',
      whatTitle: 'کیا ڈیلیٹ ہوگا',
      what1: 'آپ کا اکاؤنٹ: آپ کا نام، تصویر، تعارف، فون نمبر اور Gmail۔',
      what2: 'ہمارے سرور پر آپ کا چیٹ بیک اپ، آپ کے ڈیوائسز اور ان کی چابیاں۔',
      what3: 'آپ اپنے تمام گروپس اور کمیونٹیز سے نکل جائیں گے۔',
      what4: 'وہ پیغامات اور فائلیں جو ابھی آپ تک پہنچنی تھیں۔',
      whatKept: 'جو پیغامات آپ پہلے بھیج چکے ہیں وہ وصول کرنے والوں کے فون پر رہیں گے، جیسے ہر میسجنگ ایپ میں ہوتا ہے۔ جو تصویریں اور فائلیں آپ بھیج چکے ہیں وہ ان کے لیے معمول کے 30 دن تک رہیں گی، اور آپ کی لگائی ہوئی گروپ کی تصویر گروپ کے پاس رہے گی۔ سرور کی رات والی حفاظتی کاپیاں 14 دن میں ڈیلیٹ ہو جاتی ہیں۔',
      webTitle: 'ایپ نہیں ہے؟ یہاں ڈیلیٹ کریں',
      phoneLabel: 'آپ کا پاک چیٹ فون نمبر',
      phoneHint: 'ہم WhatsApp سے چیک کرتے ہیں کہ نمبر آپ کا ہے، بالکل ویسے جیسے پاک چیٹ سائن اِن کرتی ہے۔ یہ مفت ہے۔',
      next: 'آگے',
      wa1: 'WhatsApp کھولیں پر ٹیپ کریں۔ یہ پاک چیٹ کے لیے ایک چھوٹے پیغام کے ساتھ کھلے گا۔',
      wa2: 'بھیجیں دبائیں۔ اسی نمبر والے WhatsApp سے بھیجیں جو آپ نے لکھا ہے۔',
      wa3: 'اس صفحے پر واپس آئیں۔ یہ خود آگے بڑھے گا۔',
      openWa: 'WhatsApp کھولیں',
      waiting: 'آپ کے پیغام کا انتظار ہے…',
      back: 'نمبر بدلیں',
      cantUndo: 'یہ واپس نہیں ہو سکتا۔',
      deleteBtn: 'میرا اکاؤنٹ ڈیلیٹ کریں',
      gmailTitle: 'صرف Gmail سے سائن اِن کیا ہے؟',
      gmailText: 'اسے ایپ میں ڈیلیٹ کریں (سیٹنگز › اکاؤنٹ › میرا اکاؤنٹ ڈیلیٹ کریں)، یا اسی Gmail سے ہمیں ای میل کریں، ہم 30 دن کے اندر ڈیلیٹ کر دیں گے:',
      privacy: 'پرائیویسی پالیسی',
      terms: 'شرائطِ استعمال',
      confirm: '{phone} والا پاک چیٹ اکاؤنٹ ڈیلیٹ کریں؟',
      deleting: 'ڈیلیٹ ہو رہا ہے…',
      done: 'ہو گیا۔ {phone} والا پاک چیٹ اکاؤنٹ ڈیلیٹ ہو گیا۔',
      noAccount: '{phone} پر کوئی پاک چیٹ اکاؤنٹ نہیں۔ ڈیلیٹ کرنے کو کچھ نہیں۔',
      badPhone: 'یہ فون نمبر نہیں لگتا۔ چیک کر کے دوبارہ کوشش کریں۔',
      wrongFrom: 'یہ پیغام {from} سے آیا، {phone} سے نہیں۔ اسے {phone} والے WhatsApp سے بھیجیں۔',
      expired: 'کوڈ کا وقت ختم ہو گیا۔ نمبر بدلیں پر ٹیپ کر کے دوبارہ کوشش کریں۔',
      tooMany: 'بہت زیادہ کوششیں۔ چند منٹ رک کر دوبارہ کوشش کریں۔',
      off: 'یہ ابھی دستیاب نہیں۔ ایپ میں ڈیلیٹ کریں، یا ہمیں ای میل کریں۔',
      offline: 'پاک چیٹ سے رابطہ نہیں ہو رہا۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔',
      failed: 'یہ نہیں ہو سکا۔ اپنے نمبر سے دوبارہ شروع کریں۔',
      other: 'English',
    },
  };

  var lang = /[?&]lang=ur\b/.test(location.search) ? 'ur' : 'en';
  var check = null; // { id, secret, url, code }
  var phone = '';
  var timer = null;

  var $ = function (id) {
    return document.getElementById(id);
  };
  // Numbers are kept left to right inside Urdu sentences (else "+92..." shows as "...92+").
  var fill = function (text, values) {
    return text.replace(/\{(\w+)\}/g, function (_, k) {
      return values[k] ? '\u2066' + values[k] + '\u2069' : '';
    });
  };
  var w = function (key, values) {
    return fill(words[lang][key], values || {});
  };

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    document.title = w('title');
    var all = document.querySelectorAll('[data-t]');
    for (var i = 0; i < all.length; i++) all[i].textContent = w(all[i].getAttribute('data-t'));
    $('lang').textContent = lang === 'ur' ? 'English' : 'اردو';
    $('privacy-link').href = lang === 'ur' ? '/privacy-ur.html' : '/privacy.html';
    $('terms-link').href = lang === 'ur' ? '/terms-ur.html' : '/terms.html';
    if (phone && !$('step-confirm').hidden) $('confirm-text').textContent = w('confirm', { phone: phone });
  }

  function show(step) {
    $('step-number').hidden = step !== 'number';
    $('step-whatsapp').hidden = step !== 'whatsapp';
    $('step-confirm').hidden = step !== 'confirm';
  }

  function say(id, text) {
    $('error').hidden = true;
    $('done').hidden = true;
    if (!id) return;
    $(id).textContent = text;
    $(id).hidden = false;
  }

  function stopWaiting() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (res.status === 204) return { status: 204, json: {} };
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (json) {
          return { status: res.status, json: json };
        });
    });
  }

  function trouble(status) {
    if (status === 429) return w('tooMany');
    return w('failed');
  }

  $('step-number').addEventListener('submit', function (e) {
    e.preventDefault();
    var typed = $('phone').value.trim();
    if (!typed) return;
    $('start').disabled = true;
    say(null);
    post('/api/auth/whatsapp', { purpose: 'delete', phone: typed })
      .then(function (r) {
        if (r.status === 200) {
          check = r.json;
          phone = '';
          $('code').textContent = check.code;
          $('open-wa').href = check.url;
          show('whatsapp');
          wait();
        } else if (r.status === 422) say('error', w('badPhone'));
        else if (r.status === 404) say('error', w('off'));
        else say('error', trouble(r.status));
      })
      .catch(function () {
        say('error', w('offline'));
      })
      .then(function () {
        $('start').disabled = false;
      });
  });

  // "Has my code arrived?", every 2 seconds, like the app.
  function wait() {
    stopWaiting();
    timer = setTimeout(function () {
      if (!check) return;
      post('/api/auth/whatsapp/' + encodeURIComponent(check.id), { secret: check.secret })
        .then(function (r) {
          if (!check) return;
          if (r.status === 200 && r.json.status === 'done') {
            phone = r.json.phone;
            say(null);
            $('confirm-text').textContent = w('confirm', { phone: phone });
            show('confirm');
            return;
          }
          if (r.status === 200 && r.json.status === 'wrong_number') say('error', w('wrongFrom', { from: r.json.from, phone: $('phone').value.trim() }));
          if (r.status === 200) return wait();
          if (r.status === 422 || r.status === 404) {
            check = null;
            return say('error', w('expired'));
          }
          wait();
        })
        .catch(function () {
          // Offline for a moment: keep asking.
          wait();
        });
    }, 2000);
  }

  $('back').addEventListener('click', function () {
    stopWaiting();
    check = null;
    say(null);
    show('number');
  });

  $('delete').addEventListener('click', function () {
    if (!check || !phone) return;
    var button = $('delete');
    button.disabled = true;
    button.textContent = w('deleting');
    post('/api/account/delete', { phone: phone, code: check.secret })
      .then(function (r) {
        var shown = phone;
        if (r.status === 204) {
          show(null);
          say('done', w('done', { phone: shown }));
        } else if (r.status === 404 && r.json.error === 'no_account') {
          show(null);
          say('error', w('noAccount', { phone: shown }));
        } else {
          show('number');
          say('error', trouble(r.status));
        }
        check = null;
      })
      .catch(function () {
        say('error', w('offline'));
      })
      .then(function () {
        button.disabled = false;
        button.textContent = w('deleteBtn');
      });
  });

  $('lang').addEventListener('click', function () {
    lang = lang === 'ur' ? 'en' : 'ur';
    applyLanguage();
  });

  applyLanguage();
})();
