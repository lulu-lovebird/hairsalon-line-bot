/**
 * ============================================================
 * 理髮店 LINE 預約系統 (純 Google Apps Script 方案)
 * 
 * 本專案由 Bean, Bird & Badminton Tech Consulting 開發並維護。
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 * ============================================================
 */

// ============================================================
// 一、環境變數與全域設定 (從 Script Properties 讀取)
// ============================================================
function getProperty(key, defaultValue) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  return (val !== null && val !== undefined && val !== '') ? val : defaultValue;
}

var CONFIG = {
  CHANNEL_ACCESS_TOKEN: function() { return getProperty('LINE_CHANNEL_ACCESS_TOKEN', ''); },
  CHANNEL_SECRET: function() { return getProperty('LINE_CHANNEL_SECRET', ''); },
  SALON_NAME: function() { return getProperty('SALON_NAME', '我們的理髮店'); },
  SALON_ADDRESS: function() { return getProperty('SALON_ADDRESS', '台北市中山區南京東路一段 1 號'); },
  ADMIN_EMAIL: function() { return getProperty('ADMIN_EMAIL', ''); },
  // [推播配額控制]
  ENABLE_PUSH_REMINDER: function() { return getProperty('ENABLE_PUSH_REMINDER', 'true') === 'true'; },
  ENABLE_1H_REMINDER: function() { return getProperty('ENABLE_1H_REMINDER', 'true') === 'true'; },
  TIMEZONE: 'Asia/Taipei',
  SHEET_NAMES: {
    APPOINTMENTS: '預約紀錄',
    SERVICES: '服務項目',
    STYLISTS: '設計師名單',
    SLOTS: '營業時段'
  }
};

// ============================================================
// 二、HTTP 端點入口 (doGet / doPost)
// ============================================================

/** Webhook 健康檢查 */
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: '理髮店 LINE 預約系統運行中',
      timestamp: new Date().toISOString()
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/** 處理 LINE Messaging API 送過來的 Webhook 事件 */
function doPost(e) {
  try {
    var rawBody = e.postData.contents;
    var signature = e.parameter['x-line-signature'] || (e.headers && (e.headers['X-Line-Signature'] || e.headers['x-line-signature']));

    // [P0 安全修正] 若系統有設定 Channel Secret，嚴格驗證簽章；缺 signature 或驗章失敗一律拒絕
    var secret = CONFIG.CHANNEL_SECRET();
    if (secret) {
      if (!signature || !verifyLineSignature(rawBody, signature, secret)) {
        return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT);
      }
    }

    var eventData = JSON.parse(rawBody);
    var events = eventData.events || [];

    // 依序處理每個事件
    for (var i = 0; i < events.length; i++) {
      handleLineEvent(events[i]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('doPost Error: ' + err.toString());
    // [P1 安全修正] 不回傳詳細內部例外堆疊
    return ContentService.createTextOutput(JSON.stringify({ status: 'error' })).setMimeType(ContentService.MimeType.JSON);
  }
}

/** 驗證 LINE 數位簽章 (HMAC-SHA256 + 常數時間比較防止時序攻擊) */
function verifyLineSignature(body, signature, secret) {
  try {
    var signatureBytes = Utilities.computeHmacSha256Signature(body, secret);
    var expectedSignature = Utilities.base64Encode(signatureBytes);
    return safeStringCompare(signature, expectedSignature);
  } catch (err) {
    console.error('verifySignature error: ' + err);
    return false;
  }
}

/** 常數時間字串比對 (Constant-time comparison) */
function safeStringCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// 三、LINE 事件處理分派
// ============================================================
function handleLineEvent(event) {
  var type = event.type;
  if (type === 'message') {
    if (event.message.type === 'text') {
      handleTextMessage(event);
    }
  } else if (type === 'postback') {
    handlePostback(event);
  } else if (type === 'follow') {
    handleFollow(event);
  }
}

/** 加入好友歡迎訊息 */
function handleFollow(event) {
  var replyToken = event.replyToken;
  if (!replyToken) return;

  var salon = CONFIG.SALON_NAME();
  var welcomeText = "歡迎加入 " + salon + " 剪髮預約官方帳號 ✂️\n\n" +
                    "您可以直接點選或輸入以下功能：\n" +
                    "📅 立即預約\n" +
                    "🗓️ 我的預約\n" +
                    "❌ 取消預約\n\n" +
                    "我們竭誠為您服務！";

  replyWithQuickReply(replyToken, welcomeText, [
    { type: 'action', action: { type: 'message', label: '📅 立即預約', text: '立即預約' } },
    { type: 'action', action: { type: 'message', label: '🗓️ 我的預約', text: '我的預約' } },
    { type: 'action', action: { type: 'message', label: '❌ 取消預約', text: '取消預約' } }
  ]);
}

/** 處理純文字指令 */
function handleTextMessage(event) {
  var text = (event.message.text || '').trim();
  var replyToken = event.replyToken;
  var userId = event.source && event.source.userId;
  if (!replyToken) return;

  if (text === '預約' || text === '立即預約' || text === '預約理髮') {
    startBookingFlow(replyToken, userId);
    return;
  }

  if (text === '我的預約' || text === '查看預約') {
    showMyAppointments(replyToken, userId);
    return;
  }

  if (text === '取消預約') {
    startCancelFlow(replyToken, userId);
    return;
  }

  // 預設回應
  replyWithQuickReply(replyToken, "您好！請問今天需要為您安排什麼服務呢？", [
    { type: 'action', action: { type: 'message', label: '📅 立即預約', text: '立即預約' } },
    { type: 'action', action: { type: 'message', label: '🗓️ 我的預約', text: '我的預約' } },
    { type: 'action', action: { type: 'message', label: '❌ 取消預約', text: '取消預約' } }
  ]);
}

// ============================================================
// 四、預約流程邏輯
// ============================================================

/** 第一步：跳出日期選擇器 */
function startBookingFlow(replyToken, userId) {
  var today = getTodayTW();
  var maxDate = addDays(today, 30);

  var message = {
    type: 'template',
    altText: '請選擇預約日期',
    template: {
      type: 'buttons',
      text: '請選擇希望預約的日期（開放 30 天內）：',
      actions: [
        {
          type: 'datetimepicker',
          label: '📅 點此選擇日期',
          data: 'action=BOOKING_SELECT_STYLIST',
          mode: 'date',
          initial: today,
          min: today,
          max: maxDate
        }
      ]
    }
  };

  replyMessage(replyToken, [message]);
}

/** 第二步處理 Postback 狀態機 */
function handlePostback(event) {
  var replyToken = event.replyToken;
  var userId = event.source && event.source.userId;
  var postback = event.postback;
  if (!replyToken || !postback) return;

  // [P0 修正] 合併 datetimepicker 的日期結果（修復原本三元判斷遺漏 & 的 bug）
  var dataStr = postback.data || '';
  if (postback.params && postback.params.date) {
    dataStr += (dataStr.length > 0 ? '&' : '') + 'date=' + postback.params.date;
  }

  var params = parseQueryString(dataStr);
  var action = params['action'];

  switch (action) {
    case 'BOOKING_SELECT_STYLIST':
      handleSelectStylist(replyToken, params);
      break;
    case 'BOOKING_SELECT_SERVICE':
      handleSelectService(replyToken, params);
      break;
    case 'BOOKING_CONFIRM_PREVIEW':
      handleConfirmPreview(replyToken, userId, params);
      break;
    case 'BOOKING_SELECT_TIME_GROUP':
      handleSelectTimeGroup(replyToken, userId, params);
      break;
    case 'BOOKING_CONFIRM':
      handleBookingConfirm(replyToken, userId, params);
      break;
    case 'BOOKING_CANCEL_FLOW':
      replyMessage(replyToken, [{ type: 'text', text: '已取消本次預約流程。如需重新預約，請點選「立即預約」。' }]);
      break;
    case 'CANCEL_CONFIRM':
      handleCancelConfirm(replyToken, userId, params);
      break;
    default:
      replyMessage(replyToken, [{ type: 'text', text: '未知動作，請重新開始。' }]);
      break;
  }
}

/** 選擇設計師（或不限設計師） */
function handleSelectStylist(replyToken, params) {
  var date = params['date'];
  if (!date) {
    replyMessage(replyToken, [{ type: 'text', text: '日期錯誤，請重新點選「立即預約」。' }]);
    return;
  }

  var stylists = getActiveStylists(date);
  if (stylists.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '很抱歉，' + date + ' 當天無設計師排班，請嘗試選擇其他日期！' }]);
    return;
  }

  var items = [];
  // 不限設計師 (佔一席)
  items.push({
    type: 'action',
    action: {
      type: 'postback',
      label: '🎲 不限設計師',
      data: 'action=BOOKING_SELECT_SERVICE&date=' + date + '&stylist=' + encodeURIComponent('不限設計師'),
      displayText: '不限設計師'
    }
  });

  // 最多放 12 位設計師 (Quick Reply 限制 13 個項目)
  for (var i = 0; i < Math.min(stylists.length, 12); i++) {
    var s = stylists[i];
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: truncateUnicode('💇 ' + s.name, 20),
        data: 'action=BOOKING_SELECT_SERVICE&date=' + date + '&stylist=' + encodeURIComponent(s.name),
        displayText: '選擇 ' + s.name
      }
    });
  }

  replyWithQuickReply(replyToken, '📅 已選擇：' + date + '\n\n請選擇想指定的設計師：', items);
}

/** 選擇服務項目 */
function handleSelectService(replyToken, params) {
  var date = params['date'];
  var stylist = params['stylist'];
  if (!date || !stylist) {
    replyMessage(replyToken, [{ type: 'text', text: '預約資料遺失，請重新點選「立即預約」。' }]);
    return;
  }

  var services = getActiveServices();
  if (services.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '目前未設定任何服務項目，請聯絡店家。' }]);
    return;
  }

  var items = [];
  for (var i = 0; i < Math.min(services.length, 13); i++) {
    var svc = services[i];
    var label = truncateUnicode(svc.name + (svc.price ? ' ($' + svc.price + ')' : ''), 20);
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: label,
        data: 'action=BOOKING_CONFIRM_PREVIEW&date=' + date + '&stylist=' + encodeURIComponent(stylist) + '&service=' + encodeURIComponent(svc.name) + '&duration=' + svc.duration + '&price=' + svc.price,
        displayText: svc.name
      }
    });
  }

  var labelText = (stylist === '不限設計師') ? '不限設計師' : ('設計師：' + stylist);
  replyWithQuickReply(replyToken, labelText + '\n請選擇需要的剪髮服務：', items);
}

/** 選擇時段或進入確認頁 */
function handleConfirmPreview(replyToken, userId, params) {
  var date = params['date'];
  var stylist = params['stylist'];
  var service = params['service'];
  var duration = parseInt(params['duration'] || '30', 10);
  var price = params['price'] || '';
  var time = params['time'] || '';

  // 若尚未選時間，呼叫時段選擇
  if (!time) {
    promptSelectTime(replyToken, date, stylist, service, duration, price, null);
    return;
  }

  // 檢查時段是否依然有空
  var available = checkSlotAvailability(date, time, stylist, duration);
  if (!available) {
    replyMessage(replyToken, [{ type: 'text', text: '😢 很抱歉，' + time + ' 時段剛剛已被預約額滿，請重新選擇時段。' }]);
    return;
  }

  // 顯示 Flex 確認預約卡片
  var flexMessage = buildConfirmFlex(date, time, stylist, service, duration, price);
  replyMessage(replyToken, [flexMessage]);
}

/** 上午/下午時段次級分流 */
function handleSelectTimeGroup(replyToken, userId, params) {
  var date = params['date'];
  var stylist = params['stylist'];
  var service = params['service'];
  var duration = parseInt(params['duration'] || '30', 10);
  var price = params['price'] || '';
  var group = params['group']; // 'morning' | 'afternoon'

  promptSelectTime(replyToken, date, stylist, service, duration, price, group);
}

/** 呈現可預約時段選單 (時段超過 13 個時自動分段) */
function promptSelectTime(replyToken, date, stylist, service, duration, price, group) {
  var allSlots = getAvailableTimeSlots(date, stylist, duration);

  if (allSlots.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '😢 ' + date + ' 當天該設計師的所有時段已全數客滿，請選擇其他日期！' }]);
    return;
  }

  // 若使用者已選組別（morning / afternoon）
  if (group) {
    var filtered = allSlots.filter(function(t) {
      var hour = parseInt(t.split(':')[0], 10);
      return (group === 'morning') ? (hour < 12) : (hour >= 12);
    });

    if (filtered.length === 0) {
      replyMessage(replyToken, [{ type: 'text', text: '此區間無可用時段，請選擇其他區間。' }]);
      return;
    }

    var items = filtered.slice(0, 13).map(function(t) {
      return {
        type: 'action',
        action: {
          type: 'postback',
          label: t,
          data: 'action=BOOKING_CONFIRM_PREVIEW&date=' + date + '&stylist=' + encodeURIComponent(stylist) + '&service=' + encodeURIComponent(service) + '&duration=' + duration + '&price=' + price + '&time=' + t,
          displayText: '選擇 ' + t
        }
      };
    });

    replyWithQuickReply(replyToken, '請選擇 ' + date + '（' + (group === 'morning' ? '🌅 上午' : '🌆 下午') + '）預約時間：', items);
    return;
  }

  // 若全部時段 <= 13 個，直接送出單一 Quick Reply
  if (allSlots.length <= 13) {
    var quickItems = allSlots.map(function(t) {
      return {
        type: 'action',
        action: {
          type: 'postback',
          label: t,
          data: 'action=BOOKING_CONFIRM_PREVIEW&date=' + date + '&stylist=' + encodeURIComponent(stylist) + '&service=' + encodeURIComponent(service) + '&duration=' + duration + '&price=' + price + '&time=' + t,
          displayText: '選擇 ' + t
        }
      };
    });
    replyWithQuickReply(replyToken, '請選擇 ' + date + ' 預約時間：', quickItems);
    return;
  }

  // 若 > 13 個，先送上午/下午兩按鈕進行分流
  var morningCount = allSlots.filter(function(t) { return parseInt(t.split(':')[0], 10) < 12; }).length;
  var afternoonCount = allSlots.length - morningCount;

  var groupButtons = [];
  if (morningCount > 0) {
    groupButtons.push({
      type: 'action',
      action: {
        type: 'postback',
        label: '🌅 上午時段 (' + morningCount + '個)',
        data: 'action=BOOKING_SELECT_TIME_GROUP&group=morning&date=' + date + '&stylist=' + encodeURIComponent(stylist) + '&service=' + encodeURIComponent(service) + '&duration=' + duration + '&price=' + price,
        displayText: '選擇上午時段'
      }
    });
  }
  if (afternoonCount > 0) {
    groupButtons.push({
      type: 'action',
      action: {
        type: 'postback',
        label: '🌆 下午時段 (' + afternoonCount + '個)',
        data: 'action=BOOKING_SELECT_TIME_GROUP&group=afternoon&date=' + date + '&stylist=' + encodeURIComponent(stylist) + '&service=' + encodeURIComponent(service) + '&duration=' + duration + '&price=' + price,
        displayText: '選擇下午時段'
      }
    });
  }

  replyWithQuickReply(replyToken, date + ' 共有 ' + allSlots.length + ' 個時段，請先選擇時段區間：', groupButtons);
}

/** 確認預約並正式寫入 Google Sheet (使用 LockService 避免併發衝突) */
function handleBookingConfirm(replyToken, userId, params) {
  var lock = LockService.getScriptLock();
  try {
    // 嘗試取得全局鎖，等待至多 10 秒
    lock.waitLock(10000);

    var date = params['date'];
    var time = params['time'];
    var stylist = params['stylist'];
    var service = params['service'];
    var duration = parseInt(params['duration'] || '30', 10);
    var price = params['price'] || '';

    // 防重入與二度排碰檢查
    var isStillAvailable = checkSlotAvailability(date, time, stylist, duration);
    if (!isStillAvailable) {
      replyMessage(replyToken, [{ type: 'text', text: '😢 非常抱歉，剛才有其他人搶先一步預約了該時段，請重新選擇其他時間。' }]);
      return;
    }

    // 取得顧客名稱
    var customerName = getLineUserProfileName(userId);
    var appointmentCode = generateAppointmentCode(date);

    // 寫入 Google Sheet
    var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
    var nowString = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    
    sheet.appendRow([
      appointmentCode,     // 預約編號
      nowString,           // 建立時間
      date,                // 預約日期
      time,                // 預約時間
      stylist,             // 設計師
      service,             // 服務項目
      duration,            // 時長(分)
      customerName,        // 顧客姓名
      userId,              // LINE UID
      'confirmed',         // 狀態
      '',                  // 取消者
      '',                  // 備註
      false,               // 24h提醒已發送
      false                // 1h提醒已發送
    ]);

    // 發送預約成功卡片
    var successFlex = buildSuccessFlex(appointmentCode, date, time, stylist, service, customerName);
    replyMessage(replyToken, [successFlex]);

    // 發送 Email 通知老闆
    try {
      sendBookingEmailNotification({
        type: 'new',
        code: appointmentCode,
        customerName: customerName,
        date: date,
        time: time,
        stylist: stylist,
        service: service,
        duration: duration,
        price: price
      });
    } catch (mailErr) {
      console.warn('Booking email notification failed: ' + mailErr);
    }

  } catch (err) {
    console.error('handleBookingConfirm error: ' + err);
    replyMessage(replyToken, [{ type: 'text', text: '系統忙碌中，請稍後再試。' }]);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 查詢我的預約 */
function showMyAppointments(replyToken, userId) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    replyMessage(replyToken, [{ type: 'text', text: '您目前沒有任何有效預約紀錄。輸入「立即預約」即可安排剪髮！' }]);
    return;
  }

  var today = getTodayTW();
  var myAppointments = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var uid = row[8];
    var status = row[9];
    var date = formatDateCell(row[2]);

    if (uid === userId && status === 'confirmed' && date >= today) {
      myAppointments.push({
        code: row[0],
        date: date,
        time: formatTimeCell(row[3]),
        stylist: row[4],
        service: row[5]
      });
    }
  }

  if (myAppointments.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '您目前沒有未來的有效預約。\n\n輸入「立即預約」來預約理髮服務！' }]);
    return;
  }

  // 依照日期與時間排序
  myAppointments.sort(function(a, b) {
    return (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
  });

  var textList = myAppointments.map(function(apt, idx) {
    return '📌 預約 #' + (idx + 1) + '\n' +
           '   編號：' + apt.code + '\n' +
           '   日期：' + apt.date + ' ' + apt.time + '\n' +
           '   設計師：' + apt.stylist + '\n' +
           '   服務：' + apt.service;
  });

  var combinedText = '📋 您的有效預約（共 ' + myAppointments.length + ' 筆）：\n\n' + textList.join('\n\n');
  if (combinedText.length > 4900) {
    combinedText = combinedText.substring(0, 4900) + '\n\n（清單較長，僅顯示部分預約）';
  }

  replyMessage(replyToken, [{ type: 'text', text: combinedText }]);
}

/** 進入取消流程 */
function startCancelFlow(replyToken, userId) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  var today = getTodayTW();
  var myAppointments = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var uid = row[8];
    var status = row[9];
    var date = formatDateCell(row[2]);

    if (uid === userId && status === 'confirmed' && date >= today) {
      myAppointments.push({
        rowIndex: i + 1,
        code: row[0],
        date: date,
        time: formatTimeCell(row[3])
      });
    }
  }

  if (myAppointments.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '您目前沒有可以取消的預約。' }]);
    return;
  }

  var items = myAppointments.slice(0, 13).map(function(apt) {
    var label = truncateUnicode(apt.date + ' ' + apt.time, 20);
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: label,
        data: 'action=CANCEL_CONFIRM&code=' + apt.code,
        displayText: '取消 ' + apt.code
      }
    };
  });

  replyWithQuickReply(replyToken, '您有 ' + myAppointments.length + ' 筆有效預約，請點選要取消的時段：', items);
}

/** 確認取消預約 */
function handleCancelConfirm(replyToken, userId, params) {
  var code = params['code'];
  if (!code) {
    replyMessage(replyToken, [{ type: 'text', text: '資料錯誤，取消失敗。' }]);
    return;
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
    var data = sheet.getDataRange().getValues();
    var targetRow = -1;
    var aptInfo = null;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === code && data[i][8] === userId && data[i][9] === 'confirmed') {
        targetRow = i + 1;
        aptInfo = {
          code: data[i][0],
          date: formatDateCell(data[i][2]),
          time: formatTimeCell(data[i][3]),
          stylist: data[i][4],
          service: data[i][5],
          customerName: data[i][7]
        };
        break;
      }
    }

    if (targetRow === -1 || !aptInfo) {
      replyMessage(replyToken, [{ type: 'text', text: '找不到該預約或該預約已取消。' }]);
      return;
    }

    // 更新狀態為 cancelled
    sheet.getRange(targetRow, 10).setValue('cancelled');
    sheet.getRange(targetRow, 11).setValue('customer');

    // 先回覆顧客 LINE 訊息（優先確保 5 秒 replyToken 不超時）
    replyMessage(replyToken, [{
      type: 'text',
      text: '✅ 預約已成功取消！\n\n' +
            '編號：' + aptInfo.code + '\n' +
            '原定時間：' + aptInfo.date + ' ' + aptInfo.time + '\n\n' +
            '如需重新預約，請輸入「立即預約」。'
    }]);

    // 發送取消預約 Email 通知老闆
    try {
      sendBookingEmailNotification({
        type: 'cancel',
        code: aptInfo.code,
        customerName: aptInfo.customerName,
        date: aptInfo.date,
        time: aptInfo.time,
        stylist: aptInfo.stylist,
        service: aptInfo.service
      });
    } catch (mailErr) {
      console.warn('Cancel email notification failed: ' + mailErr);
    }

  } catch (err) {
    console.error('handleCancelConfirm error: ' + err);
    replyMessage(replyToken, [{ type: 'text', text: '處理失敗，請稍後再試。' }]);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============================================================
// 五、試算表資料存取層 (Google Sheet Storage)
// ============================================================

/**
 * [手動/首次初始化] 一次建立並初始化所有分頁
 * 可以在 Apps Script 編輯器上方選擇「initSheets」並點選「執行」
 */
function initSheets() {
  getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.SERVICES);
  getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.SLOTS);

  // 嘗試移除 Google 試算表剛建立時預設的空白「工作表1」或「Sheet1」
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defaultSheets = ['工作表1', 'Sheet1'];
  for (var i = 0; i < defaultSheets.length; i++) {
    var def = ss.getSheetByName(defaultSheets[i]);
    if (def && ss.getSheets().length > 1) {
      try { ss.deleteSheet(def); } catch (e) {}
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('4 個分頁已成功建立並初始化完成！', '✂️ 系統初始化成功', 5);
}

/**
 * 試算表開啟時自動建立選單
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('✂️ 理髮店系統')
    .addItem('🚀 初始化/檢查所有分頁', 'initSheets')
    .addToUi();
}

/** 取得或初始化工作表 */
function getOrCreateSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) return sheet;

  sheet = ss.insertSheet(sheetName);

  if (sheetName === CONFIG.SHEET_NAMES.APPOINTMENTS) {
    sheet.appendRow([
      '預約編號', '建立時間', '預約日期', '預約時間', '設計師',
      '服務項目', '服務時長(分)', '顧客姓名', 'LINE UID',
      '狀態', '取消者', '備註', '24h提醒', '1h提醒'
    ]);
    sheet.getRange(1, 1, 1, 14).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheetName === CONFIG.SHEET_NAMES.SERVICES) {
    sheet.appendRow(['服務名稱', '時長(分鐘)', '價格', '狀態(啟用/停用)', '排序']);
    sheet.getRange(1, 1, 1, 5).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.appendRow(['一般剪髮', 30, 350, '啟用', 1]);
    sheet.appendRow(['洗髮 + 剪髮', 45, 450, '啟用', 2]);
    sheet.appendRow(['染髮 (含洗剪)', 90, 1500, '啟用', 3]);
    sheet.appendRow(['燙髮 (含洗剪)', 120, 1800, '啟用', 4]);
    sheet.appendRow(['頭皮護理', 45, 600, '啟用', 5]);
    sheet.setFrozenRows(1);
  } else if (sheetName === CONFIG.SHEET_NAMES.STYLISTS) {
    sheet.appendRow(['設計師姓名', '狀態(啟用/停用)', '上班星期(0-6逗號分開)', '上班時間', '下班時間']);
    sheet.getRange(1, 1, 1, 5).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.appendRow(['店長 Leo', '啟用', '1,2,3,4,5,6', '10:00', '20:00']);
    sheet.appendRow(['設計師 Kelly', '啟用', '2,3,4,5,6,0', '11:00', '19:00']);
    sheet.setFrozenRows(1);
  } else if (sheetName === CONFIG.SHEET_NAMES.SLOTS) {
    sheet.appendRow(['營業開始時間', '營業結束時間', '時段間隔(分鐘)', '同時段最大接客數']);
    sheet.getRange(1, 1, 1, 4).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.appendRow(['10:00', '20:00', 30, 2]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/** 取得所有啟用的服務項目 */
function getActiveServices() {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.SERVICES);
  var data = sheet.getDataRange().getValues();
  var services = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    var duration = parseInt(data[i][1] || '30', 10);
    var price = data[i][2];
    var status = data[i][3];
    if (name && status === '啟用') {
      services.push({ name: name, duration: duration, price: price });
    }
  }
  return services;
}

/** 取得特定日期有上班的設計師 */
function getActiveStylists(dateStr) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
  var data = sheet.getDataRange().getValues();
  var dayOfWeek = getDayOfWeek(dateStr); // 0=Sun, 1=Mon...
  var stylists = [];

  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    var status = data[i][1];
    var workDays = (data[i][2] || '').toString().split(',').map(function(s) { return s.trim(); });
    if (name && status === '啟用') {
      if (workDays.indexOf(dayOfWeek.toString()) >= 0) {
        stylists.push({ name: name, startTime: data[i][3], endTime: data[i][4] });
      }
    }
  }
  return stylists;
}

/** 取得該日期的可用時段清單 */
function getAvailableTimeSlots(dateStr, stylistName, durationMin) {
  var slotSheet = getOrCreateSheet(CONFIG.SHEET_NAMES.SLOTS);
  var slotConfig = slotSheet.getRange(2, 1, 1, 4).getValues()[0];
  var openTime = formatTimeCell(slotConfig[0]) || '10:00';
  var closeTime = formatTimeCell(slotConfig[1]) || '20:00';
  var interval = parseInt(slotConfig[2] || '30', 10);
  var maxCapacity = parseInt(slotConfig[3] || '2', 10);

  var openMin = timeToMinutes(openTime);
  var closeMin = timeToMinutes(closeTime);

  // 讀取該日期所有 confirmed 的預約
  var apptSheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var apptData = apptSheet.getDataRange().getValues();
  var existingBookings = [];

  for (var i = 1; i < apptData.length; i++) {
    var rowDate = formatDateCell(apptData[i][2]);
    var rowStatus = apptData[i][9];
    if (rowDate === dateStr && rowStatus === 'confirmed') {
      existingBookings.push({
        start: timeToMinutes(formatTimeCell(apptData[i][3])),
        duration: parseInt(apptData[i][6] || '30', 10),
        stylist: apptData[i][4]
      });
    }
  }

  var today = getTodayTW();
  var nowHHMM = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm');
  var nowMin = timeToMinutes(nowHHMM);

  var availableSlots = [];
  for (var m = openMin; m + durationMin <= closeMin; m += interval) {
    var slotTimeStr = minutesToTime(m);

    // 今天：過濾掉已經過去的時間
    if (dateStr === today && m <= nowMin) {
      continue;
    }

    var slotStart = m;
    var slotEnd = m + durationMin;

    // 檢查全店最大容量
    var overlapCount = existingBookings.filter(function(b) {
      return (slotStart < (b.start + b.duration) && slotEnd > b.start);
    }).length;

    if (overlapCount >= maxCapacity) {
      continue;
    }

    // 若指定了設計師，檢查該設計師是否衝突
    if (stylistName && stylistName !== '不限設計師') {
      var stylistConflict = existingBookings.some(function(b) {
        return (b.stylist === stylistName && (slotStart < (b.start + b.duration) && slotEnd > b.start));
      });
      if (stylistConflict) {
        continue;
      }
    }

    availableSlots.push(slotTimeStr);
  }

  return availableSlots;
}

/** 檢查特定時段是否仍有空位 (二度驗證防碰撞) */
function checkSlotAvailability(dateStr, timeStr, stylistName, durationMin) {
  var slots = getAvailableTimeSlots(dateStr, stylistName, durationMin);
  return slots.indexOf(timeStr) >= 0;
}

// ============================================================
// 六、LINE Flex Message 模板建構
// ============================================================

/** 產生確認預約 Flex Bubble */
function buildConfirmFlex(date, time, stylist, service, duration, price) {
  var confirmData = 'action=BOOKING_CONFIRM&date=' + date +
                    '&time=' + time +
                    '&stylist=' + encodeURIComponent(stylist) +
                    '&service=' + encodeURIComponent(service) +
                    '&duration=' + duration +
                    '&price=' + price;

  return {
    type: 'flex',
    altText: '預約確認：' + date + ' ' + time,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2D5016',
        contents: [
          { type: 'text', text: '✂️ 預約確認', color: '#FFFFFF', weight: 'bold', size: 'lg' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          buildFlexInfoRow('📅 日期', date),
          buildFlexInfoRow('🕐 時間', time),
          buildFlexInfoRow('💇 設計師', stylist),
          buildFlexInfoRow('✂️ 服務項目', service),
          buildFlexInfoRow('⏱️ 預估時長', duration + ' 分鐘'),
          buildFlexInfoRow('💰 參考價格', price ? ('NT$ ' + price) : '依現場確認')
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#2D5016',
            action: { type: 'postback', label: '✅ 確認送出', data: confirmData }
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: '❌ 取消', data: 'action=BOOKING_CANCEL_FLOW' }
          }
        ]
      }
    }
  };
}

/** 產生預約成功 Flex Bubble */
function buildSuccessFlex(code, date, time, stylist, service, customerName) {
  var salon = CONFIG.SALON_NAME();
  var address = CONFIG.SALON_ADDRESS();

  return {
    type: 'flex',
    altText: '🎉 預約成功！編號 ' + code,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2D5016',
        contents: [
          { type: 'text', text: '🎉 預約成功！', color: '#FFFFFF', weight: 'bold', size: 'lg' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          buildFlexInfoRow('📋 預約編號', code),
          buildFlexInfoRow('👤 顧客姓名', customerName),
          buildFlexInfoRow('📅 預約日期', date),
          buildFlexInfoRow('🕐 預約時間', time),
          buildFlexInfoRow('💇 指定設計師', stylist),
          buildFlexInfoRow('✂️ 預約服務', service),
          buildFlexInfoRow('📍 店家地址', address)
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '感謝您預約 ' + salon + '，我們期待為您服務！\nDeveloped with ❤️ by Bean, Bird & Badminton Tech Consulting',
            size: 'xxs',
            color: '#888888',
            wrap: true,
            align: 'center'
          }
        ]
      }
    }
  };
}

function buildFlexInfoRow(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#666666', flex: 3 },
      { type: 'text', text: value, size: 'sm', color: '#111111', weight: 'bold', flex: 5, wrap: true }
    ]
  };
}

// ============================================================
// 七、排程提醒 (Time-driven Trigger 每 15 分鐘執行一次)
// ============================================================

/** 自動提醒排程任務 (需掛載 GAS 觸發器：每 15 分鐘) */
function sendBookingReminders() {
  // [配額開關 1] 若總開關被關閉，直接跳過所有主動推播
  if (!CONFIG.ENABLE_PUSH_REMINDER()) {
    console.log('Push reminders disabled via ENABLE_PUSH_REMINDER=false');
    return;
  }

  // [配額守門員] 檢查本月 LINE Push 消耗量，若已達 190 則（快滿 200）自動暫停推播並寄信警報
  if (checkAndWarnPushQuota()) {
    console.warn('Push quota threshold reached (>= 190), skipping reminders to prevent silent failure.');
    return;
  }

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var now = new Date();
  var today = getTodayTW();
  var tomorrow = addDays(today, 1);
  var currentHour = parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH'), 10);
  var currentMin = parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'mm'), 10);
  var nowTotalMin = currentHour * 60 + currentMin;

  var salon = CONFIG.SALON_NAME();
  var address = CONFIG.SALON_ADDRESS();

  // [配額開關 2] 是否啟用 1 小時前提醒
  var enable1h = CONFIG.ENABLE_1H_REMINDER();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var code = row[0];
    var apptDate = formatDateCell(row[2]);
    var apptTime = formatTimeCell(row[3]);
    var stylist = row[4];
    var service = row[5];
    var lineUid = row[8];
    var status = row[9];
    var sent24h = row[12];
    var sent1h = row[13];

    if (status !== 'confirmed' || !lineUid) continue;

    // ── 24h 提醒 (每晚 20:00～20:14 統一推播明天的預約) ────────────────
    if (currentHour === 20 && apptDate === tomorrow && !sent24h) {
      try {
        var msg24h = "📅 明日預約提醒\n\n" +
                     "明天 " + apptTime + " 有您在 " + salon + " 的剪髮預約！\n" +
                     "設計師：" + stylist + "\n" +
                     "服務項目：" + service + "\n" +
                     "預約編號：" + code + "\n\n" +
                     "我們在 " + address + " 期待您的到來！";
        pushTextMessage(lineUid, msg24h);
        sheet.getRange(i + 1, 13).setValue(true);
      } catch (e) {
        console.error('24h push error for ' + code + ': ' + e);
      }
    }

    // ── 1h 提醒 (時段前 60 分鐘 ± 7 分鐘窗口，受 ENABLE_1H_REMINDER 控制) ──────
    if (enable1h && apptDate === today && !sent1h) {
      var apptTotalMin = timeToMinutes(apptTime);
      var diffMin = apptTotalMin - nowTotalMin;

      // 剩餘時間約在 53 ~ 67 分鐘之間
      if (diffMin >= 53 && diffMin <= 67) {
        try {
          var msg1h = "⏰ 預約快到囉！\n\n" +
                      "再過 1 小時就是您在 " + salon + " 的預約時間（" + apptTime + "）！\n" +
                      "設計師：" + stylist + "\n" +
                      "地點：" + address + "\n\n" +
                      "請準時到店，我們等您！";
          pushTextMessage(lineUid, msg1h);
          sheet.getRange(i + 1, 14).setValue(true);
        } catch (e) {
          console.error('1h push error for ' + code + ': ' + e);
        }
      }
    }
  }
}

/** 查詢 LINE 當月已消耗的 Push 訊息數量 */
function getLineMonthlyPushConsumption() {
  try {
    var url = 'https://api.line.me/v2/bot/message/quota/consumption';
    var options = {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + CONFIG.CHANNEL_ACCESS_TOKEN() },
      muteHttpExceptions: true
    };
    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    if (code === 200) {
      var data = JSON.parse(res.getContentText());
      return typeof data.totalUsage === 'number' ? data.totalUsage : 999;
    }
    // non-200 (Token 錯誤、伺服器異常等)：保守回傳 999，傾向暫停推播防靜默失敗
    console.warn('getLineMonthlyPushConsumption non-200: HTTP ' + code);
    return 999;
  } catch (e) {
    console.warn('getLineMonthlyPushConsumption error: ' + e);
    // 網路連線逾時或其他異常時，保守回傳 999
    return 999;
  }
}

/**
 * 檢查 Push 配額是否即將耗盡 (>= 190 則)，若超量則寄信預警並回傳 true
 */
function checkAndWarnPushQuota() {
  var used = getLineMonthlyPushConsumption();
  if (used < 190) return false;

  // 使用 Script Properties 防止同月份重複發送警報信
  var currentMonthKey = 'QUOTA_WARNED_' + getTodayTW().substring(0, 7); // 例如 QUOTA_WARNED_2026-10
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(currentMonthKey)) {
    props.setProperty(currentMonthKey, 'true');
    try {
      sendPushQuotaAlertEmail(used);
    } catch (e) {
      console.warn('Failed to send push quota alert email: ' + e);
    }
  }
  return true;
}

/** 發送 LINE 推播配額預警 Email 給老闆 */
function sendPushQuotaAlertEmail(used) {
  var recipient = CONFIG.ADMIN_EMAIL();
  if (!recipient) {
    try { recipient = Session.getEffectiveUser().getEmail(); } catch (e) {}
  }
  if (!recipient) return;

  var salon = CONFIG.SALON_NAME();
  var subject = '⚠️ [' + salon + ' 系統警告] LINE 免費推播即將用盡 (' + used + '/200 則)';
  var htmlBody = '' +
    '<div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:20px; border:1px solid #fed7d7; border-radius:12px; background-color:#fff5f5;">' +
      '<h2 style="color:#c53030; margin-top:0;">⚠️ LINE 免費推播即將耗盡</h2>' +
      '<p style="color:#2d3748; font-size:14px; line-height:1.6;">' +
        '店長您好：<br><br>' +
        '您的 LINE 官方帳號本月份免費推播訊息已累計使用 <strong>' + used + ' / 200 則</strong>。<br>' +
        '為避免超過 LINE 免費方案額度導致推播靜默失敗，系統已<strong>自動暫停本月份後續的「24h / 1h 提醒推播」</strong>。' +
      '</p>' +
      '<div style="background-color:#ffffff; padding:12px; border-radius:8px; border:1px solid #e2e8f0; font-size:13px; color:#4a5568; margin:16px 0;">' +
        '💡 <strong>溫馨提醒：</strong><br>' +
        '• 顧客線上預約、即時查詢與取消預約功能<strong>完全不受影響</strong>（Reply Message 無限免費）。<br>' +
        '• 下個月 1 號 LINE 將自動重置 200 則額度，推播會自動恢復。<br>' +
        '• 若希望節省配額，可至 Apps Script「專案設定 > 指令碼屬性」將 <code>ENABLE_1H_REMINDER</code> 設為 <code>false</code>（僅保留前一晚提醒，推播消耗減半）。' +
      '</div>' +
      '<p style="text-align:center; font-size:12px; color:#a0aec0; margin-bottom:0;">' +
        'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting' +
      '</p>' +
    '</div>';

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody
  });
}

// ============================================================
// 八、LINE API 呼叫工具
// ============================================================
function replyMessage(replyToken, messages) {
  var url = 'https://api.line.me/v2/bot/message/reply';
  var payload = { replyToken: replyToken, messages: messages };
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.CHANNEL_ACCESS_TOKEN()
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() !== 200) {
    console.error('replyMessage error: ' + res.getContentText());
  }
}

function replyWithQuickReply(replyToken, text, items) {
  replyMessage(replyToken, [{
    type: 'text',
    text: text,
    quickReply: { items: items }
  }]);
}

function pushTextMessage(to, text) {
  var url = 'https://api.line.me/v2/bot/message/push';
  var payload = { to: to, messages: [{ type: 'text', text: text }] };
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.CHANNEL_ACCESS_TOKEN()
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, options);
}

function getLineUserProfileName(userId) {
  try {
    var url = 'https://api.line.me/v2/bot/profile/' + userId;
    var options = {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + CONFIG.CHANNEL_ACCESS_TOKEN() },
      muteHttpExceptions: true
    };
    var res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200) {
      var data = JSON.parse(res.getContentText());
      return data.displayName || '顧客';
    }
  } catch (e) {
    console.warn('getLineUserProfileName error: ' + e);
  }
  return '顧客';
}

// ============================================================
// 九、輔助時間與字串工具函式 (時區嚴格處理)
// ============================================================

/** 取得台灣現在日期 YYYY-MM-DD */
function getTodayTW() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/** [P0 時區修正] 以 UTC 午夜增加天數，避免 GAS 宿主環境時區漂移 */
function addDays(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  // 保持以 UTC 格式化字串，確保天數精準不因跨時區而跳日
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/** [P0 時區修正] 安全解析星期幾（0=Sun ~ 6=Sat），強制指定台北 UTC+8 */
function getDayOfWeek(dateStr) {
  var d = new Date(dateStr + 'T12:00:00+08:00'); // 正午解析，不受邊界影響
  return d.getUTCDay();
}

function timeToMinutes(timeStr) {
  var parts = (timeStr || '00:00').split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function minutesToTime(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function formatDateCell(cellVal) {
  if (!cellVal) return '';
  if (cellVal instanceof Date) {
    return Utilities.formatDate(cellVal, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  return cellVal.toString().trim();
}

function formatTimeCell(cellVal) {
  if (!cellVal) return '';
  if (cellVal instanceof Date) {
    return Utilities.formatDate(cellVal, CONFIG.TIMEZONE, 'HH:mm');
  }
  var str = cellVal.toString().trim();
  return str.substring(0, 5);
}

/** [P1 修正] 隨機 + 時間戳微秒避免生日悖論碰撞 */
function generateAppointmentCode(dateStr) {
  var d = dateStr.replace(/-/g, '');
  var ts = (new Date().getTime() % 10000).toString(); // 取時間戳後4碼
  var rand = Math.floor(10 + Math.random() * 90);      // 2碼隨機數
  return 'HS-' + d + '-' + ts + rand;
}

/** [P1 修正] 安全處理含有 '=' 值的 Query String */
function parseQueryString(str) {
  var res = {};
  if (!str) return res;
  var pairs = str.split('&');
  for (var i = 0; i < pairs.length; i++) {
    var eqIdx = pairs[i].indexOf('=');
    if (eqIdx > 0) {
      var key = pairs[i].substring(0, eqIdx);
      var val = pairs[i].substring(eqIdx + 1);
      res[key] = decodeURIComponent(val);
    }
  }
  return res;
}

/** [P1 修正] 安全截斷 UTF-16 字串避免破壞 Emoji Surrogate Pair */
function truncateUnicode(str, maxLen) {
  if (!str) return '';
  var chars = Array.from(str);
  if (chars.length <= maxLen) return str;
  return chars.slice(0, maxLen).join('');
}

/** HTML 字符安全跳脫 (防止 Email HTML 注入/XSS) */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// 十、Email 通知工具 (發信給老闆/店長)
// ============================================================

/**
 * 發送預約成立或取消通知信
 * @param {Object} data 包含 type ('new'|'cancel'), code, customerName, date, time, stylist, service 等
 */
function sendBookingEmailNotification(data) {
  // 決定收件者：優先採用 Script Property ADMIN_EMAIL，若未設定則自動使用試算表擁有者
  var recipient = CONFIG.ADMIN_EMAIL();
  if (!recipient) {
    try {
      recipient = Session.getEffectiveUser().getEmail();
    } catch (e) {
      recipient = '';
    }
  }

  if (!recipient) {
    console.warn('sendBookingEmailNotification: No recipient email found.');
    return;
  }

  var salon = CONFIG.SALON_NAME();
  var isNew = (data.type === 'new');
  var safeCustomer = escapeHtml(data.customerName);
  var safeStylist = escapeHtml(data.stylist);
  var safeService = escapeHtml(data.service);
  var safeSalon = escapeHtml(salon);

  var subject = isNew
    ? ('✂️ [' + salon + ' 新預約] ' + data.customerName + ' - ' + data.date + ' ' + data.time + ' (' + data.stylist + ')')
    : ('❌ [' + salon + ' 預約取消] ' + data.customerName + ' - ' + data.date + ' ' + data.time + ' (' + data.code + ')');

  var title = isNew ? '🎉 收到一筆新的剪髮預約！' : '⚠️ 有一筆預約已由顧客取消';
  var statusBadge = isNew
    ? '<span style="background-color:#2D5016;color:#ffffff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:bold;">已確認 (Confirmed)</span>'
    : '<span style="background-color:#c53030;color:#ffffff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:bold;">已取消 (Cancelled)</span>';

  var sheetUrl = '';
  try {
    sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  } catch (e) {}

  var htmlBody = '' +
    '<div style="font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; max-width:600px; margin:0 auto; padding:24px; border:1px solid #e2e8f0; border-radius:16px; background-color:#ffffff;">' +
      '<div style="border-bottom:2px solid #2D5016; padding-bottom:16px; margin-bottom:20px;">' +
        '<h2 style="color:#2D5016; margin:0 0 8px 0; font-size:20px;">' + safeSalon + ' 預約通知</h2>' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<h3 style="color:#1a202c; margin:0; font-size:16px;">' + title + '</h3>' +
          statusBadge +
        '</div>' +
      '</div>' +

      '<table style="width:100%; border-collapse:collapse; margin-bottom:24px;">' +
        '<tr><td style="padding:8px 0; color:#718096; width:120px; font-size:14px;">預約編號</td><td style="padding:8px 0; color:#1a202c; font-weight:bold; font-size:14px;">' + escapeHtml(data.code) + '</td></tr>' +
        '<tr><td style="padding:8px 0; color:#718096; font-size:14px;">顧客姓名</td><td style="padding:8px 0; color:#1a202c; font-weight:bold; font-size:14px;">' + safeCustomer + '</td></tr>' +
        '<tr><td style="padding:8px 0; color:#718096; font-size:14px;">預約日期</td><td style="padding:8px 0; color:#1a202c; font-size:14px;">' + escapeHtml(data.date) + '</td></tr>' +
        '<tr><td style="padding:8px 0; color:#718096; font-size:14px;">預約時間</td><td style="padding:8px 0; color:#2D5016; font-weight:bold; font-size:16px;">' + escapeHtml(data.time) + '</td></tr>' +
        '<tr><td style="padding:8px 0; color:#718096; font-size:14px;">指定設計師</td><td style="padding:8px 0; color:#1a202c; font-size:14px;">' + safeStylist + '</td></tr>' +
        '<tr><td style="padding:8px 0; color:#718096; font-size:14px;">預約項目</td><td style="padding:8px 0; color:#1a202c; font-size:14px;">' + safeService + (data.duration ? (' (' + parseInt(data.duration, 10) + '分鐘)') : '') + '</td></tr>' +
        (isNew && data.price ? ('<tr><td style="padding:8px 0; color:#718096; font-size:14px;">參考金額</td><td style="padding:8px 0; color:#1a202c; font-size:14px;">NT$ ' + escapeHtml(data.price) + '</td></tr>') : '') +
      '</table>' +

      (sheetUrl ? (
        '<div style="text-align:center; margin-bottom:24px;">' +
          '<a href="' + sheetUrl + '" target="_blank" style="background-color:#2D5016; color:#ffffff; text-decoration:none; padding:10px 24px; border-radius:8px; font-weight:bold; font-size:14px; display:inline-block;">開啟 Google 試算表查看</a>' +
        '</div>'
      ) : '') +

      '<div style="border-top:1px solid #edf2f7; padding-top:16px; text-align:center; color:#a0aec0; font-size:12px;">' +
        '本信件由 ' + safeSalon + ' 預約系統自動發送<br>' +
        'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting' +
      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody
  });
}

