/**
 * ============================================================
 * 理髮店 LINE 預約系統 (純 Google Apps Script 方案)
 * 
 * 本專案由 Bean, Bird & Badminton Tech Consulting 開發並維護。
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 * ============================================================
 */
/** @OnlyCurrentDoc */

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
  WEBHOOK_TOKEN: function() { return getProperty('WEBHOOK_TOKEN', ''); },
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
    SLOTS: '營業時段',
    REPORTS: '營運報表'
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
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
    }

    // [P0-1 安全強化] 若有設定自訂 WEBHOOK_TOKEN，強制檢查 URL 參數 ?token=...
    var expectedToken = CONFIG.WEBHOOK_TOKEN();
    if (expectedToken) {
      var incomingToken = e.parameter ? (e.parameter['token'] || '') : '';
      if (!safeStringCompare(incomingToken, expectedToken)) {
        console.warn('doPost: Invalid or missing webhook token');
        return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT);
      }
    }

    var rawBody = e.postData.contents;
    var signature = e.parameter ? (e.parameter['x-line-signature'] || e.parameter['signature']) : null;
    var secret = CONFIG.CHANNEL_SECRET();

    if (signature && secret) {
      if (!verifyLineSignature(rawBody, signature, secret)) {
        console.warn('doPost: Invalid signature');
        return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT);
      }
    }

    var eventData = JSON.parse(rawBody);
    var events = eventData.events || [];

    // 若為 LINE Console Verify 測試請求 (events 為空陣列)
    if (events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Verified' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 依序處理每個真實事件
    for (var i = 0; i < events.length; i++) {
      handleLineEvent(events[i]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error('doPost Error: ' + err.toString());
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

  // 1. 設計師金鑰綁定指令（例：綁定 HS-8K2M）
  if (text.indexOf('綁定') === 0) {
    var code = text.substring(2).trim();
    handleStylistBinding(replyToken, userId, code);
    return;
  }

  // 檢查發訊者是否為已登記的設計師或店長
  var staff = getStaffInfoByUid(userId);

  // 2. 設計師專屬指令
  if (staff) {
    if (text === '今日行程' || text === '今天行程') {
      showStaffSchedule(replyToken, staff, getTodayTW(), '今日');
      return;
    }
    if (text === '明日行程' || text === '明天行程') {
      showStaffSchedule(replyToken, staff, addDays(getTodayTW(), 1), '明日');
      return;
    }
    if (text === '我的業績' || text === '本月業績') {
      showStaffRevenue(replyToken, staff);
      return;
    }
    if (text === '完成' || text === '結帳') {
      promptCompleteBooking(replyToken, staff);
      return;
    }

    // 3. 店長 (owner) 專屬指令
    if (staff.role === 'owner') {
      if (text === '日報' || text === '今日總覽') {
        showOwnerDailySummary(replyToken, getTodayTW());
        return;
      }
    }
  }

  // 4. 一般顧客指令
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

  // 預設回應（若為店內同仁，多提示管理指令）
  var defaultItems = [
    { type: 'action', action: { type: 'message', label: '📅 立即預約', text: '立即預約' } },
    { type: 'action', action: { type: 'message', label: '🗓️ 我的預約', text: '我的預約' } },
    { type: 'action', action: { type: 'message', label: '❌ 取消預約', text: '取消預約' } }
  ];

  if (staff) {
    defaultItems.push({ type: 'action', action: { type: 'message', label: '💈 今日行程', text: '今日行程' } });
    defaultItems.push({ type: 'action', action: { type: 'message', label: '💰 我的業績', text: '我的業績' } });
    defaultItems.push({ type: 'action', action: { type: 'message', label: '✅ 完成結帳', text: '完成' } });
    if (staff.role === 'owner') {
      defaultItems.push({ type: 'action', action: { type: 'message', label: '📊 今日日報', text: '日報' } });
    }
  }

  replyWithQuickReply(replyToken, "您好！請問今天需要為您安排什麼服務呢？", defaultItems.slice(0, 13));
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
    case 'COMPLETE_CONFIRM':
      handleCompleteConfirm(replyToken, userId, params);
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

    // 伺服器端取定價 (防止竄改)，預設實收等於定價
    var officialPrice = getOfficialServicePrice(service);
    var confirmedPrice = officialPrice > 0 ? officialPrice : (parseInt(params['price'] || '0', 10));

    // 取得顧客名稱 (防公式注入：若開頭為 =,+,-,@ 則補 ' 前綴)
    var rawCustomerName = getLineUserProfileName(userId);
    var customerName = sanitizeFormulaInput(rawCustomerName);
    var appointmentCode = generateAppointmentCode(date);

    // 寫入 Google Sheet (含第 15 欄定價、第 16 欄實收、第 17 欄結帳時間)
    var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
    var nowString = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    
    sheet.appendRow([
      appointmentCode,     // 1. 預約編號
      nowString,           // 2. 建立時間
      date,                // 3. 預約日期
      time,                // 4. 預約時間
      stylist,             // 5. 設計師
      service,             // 6. 服務項目
      duration,            // 7. 時長(分)
      customerName,        // 8. 顧客姓名
      userId,              // 9. LINE UID
      'confirmed',         // 10. 狀態
      '',                  // 11. 取消者
      '',                  // 12. 備註
      false,               // 13. 24h提醒已發送
      false,               // 14. 1h提醒已發送
      confirmedPrice,      // 15. 定價
      confirmedPrice,      // 16. 實收金額
      ''                   // 17. 結帳時間
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
        price: confirmedPrice
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

// ============================================================
// 五、試算表資料存取層 (Google Sheet Storage) 與 管理選單功能
// ============================================================

/**
 * [手動/首次初始化] 一次建立並初始化所有分頁
 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // [P0-3 修正] 強制設定試算表時區為台北，確保 Date 物件解析一致
  try { ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE); } catch (e) {}

  getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.SERVICES);
  getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.SLOTS);

  // 嘗試移除 Google 試算表剛建立時預設的空白「工作表1」或「Sheet1」
  var defaultSheets = ['工作表1', 'Sheet1'];
  for (var i = 0; i < defaultSheets.length; i++) {
    var def = ss.getSheetByName(defaultSheets[i]);
    if (def && ss.getSheets().length > 1) {
      try { ss.deleteSheet(def); } catch (e) {}
    }
  }

  upgradeSheetColumns();
  SpreadsheetApp.getActiveSpreadsheet().toast('所有分頁與欄位已就緒！', '✂️ 初始化成功', 5);
}

/**
 * [資料庫平滑升級] 檢查並升級欄位 (不覆蓋舊資料)
 */
function upgradeSheetColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var apptSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.APPOINTMENTS);
  if (apptSheet) {
    // [P0-3 修正] 日期(C)、時間(D)、姓名(H) 預先強制設為純文字格式，避免自動轉 Date 造成 QUERY 損壞
    try {
      apptSheet.getRange('C:D').setNumberFormat('@');
      apptSheet.getRange('H:H').setNumberFormat('@');
    } catch (e) {}

    var headerRow = apptSheet.getRange(1, 1, 1, apptSheet.getLastColumn()).getValues()[0];
    if (headerRow.length < 17) {
      if (headerRow.length < 15) apptSheet.getRange(1, 15).setValue('定價');
      if (headerRow.length < 16) apptSheet.getRange(1, 16).setValue('實收金額');
      if (headerRow.length < 17) apptSheet.getRange(1, 17).setValue('結帳時間');
      apptSheet.getRange(1, 15, 1, 3).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    }
    setupStatusDataValidation(apptSheet);
  }

  // 檢查設計師名單是否包含 LINE UID、角色、綁定碼
  var stylistSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STYLISTS);
  if (stylistSheet) {
    var stylistHeaders = stylistSheet.getRange(1, 1, 1, stylistSheet.getLastColumn()).getValues()[0];
    if (stylistHeaders.length < 8) {
      if (stylistHeaders.length < 6) stylistSheet.getRange(1, 6).setValue('LINE UID');
      if (stylistHeaders.length < 7) stylistSheet.getRange(1, 7).setValue('角色(owner/stylist)');
      if (stylistHeaders.length < 8) stylistSheet.getRange(1, 8).setValue('綁定碼');
      stylistSheet.getRange(1, 6, 1, 3).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    }
  }

  ss.toast('資料欄位已檢查並升級至最新版本！', '🔧 檢查完成', 5);
}

/** 設定預約狀態下拉清單驗證 (confirmed, completed, cancelled, no_show) */
function setupStatusDataValidation(sheet) {
  try {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['confirmed', 'completed', 'cancelled', 'no_show'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, 10, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  } catch (e) {}
}

/**
 * [選單功能 1] 產生 / 重新整理「營運報表」看板分頁
 */
function buildOrRefreshReportsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = CONFIG.SHEET_NAMES.REPORTS;
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  // 標題大橫幅
  sheet.getRange('A1:F1').merge().setValue('✂️ ' + CONFIG.SALON_NAME() + ' — 營運即時看板')
    .setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(16)
    .setHorizontalAlignment('center');

  sheet.getRange('A2:F2').merge().setValue('最後刷新時間：' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss') + '（點選「✂️ 理髮店系統 > 產生/重新整理營運報表」隨時更新）')
    .setFontColor('#718096').setFontSize(10).setHorizontalAlignment('center');

  // 今日業績看板 (區塊 A，使用動態 TODAY() 公式，不重新按按鈕也即時動態反映)
  sheet.getRange('A4').setValue('📅 今日預約概況 (即時動態)').setFontWeight('bold').setFontSize(13);
  sheet.getRange('A5:E5').setValues([['總預約數', '已完成(結帳)', '待服務', '已取消', '今日營收小計']])
    .setBackground('#edf2f7').setFontWeight('bold').setHorizontalAlignment('center');

  sheet.getRange('A6').setFormula('=COUNTIFS(\'預約紀錄\'!C:C, TEXT(TODAY(), "yyyy-MM-dd"))');
  sheet.getRange('B6').setFormula('=COUNTIFS(\'預約紀錄\'!C:C, TEXT(TODAY(), "yyyy-MM-dd"), \'預約紀錄\'!J:J, "completed")');
  sheet.getRange('C6').setFormula('=COUNTIFS(\'預約紀錄\'!C:C, TEXT(TODAY(), "yyyy-MM-dd"), \'預約紀錄\'!J:J, "confirmed")');
  sheet.getRange('D6').setFormula('=COUNTIFS(\'預約紀錄\'!C:C, TEXT(TODAY(), "yyyy-MM-dd"), \'預約紀錄\'!J:J, "cancelled")');
  sheet.getRange('E6').setFormula('=SUMIFS(\'預約紀錄\'!P:P, \'預約紀錄\'!C:C, TEXT(TODAY(), "yyyy-MM-dd"), \'預約紀錄\'!J:J, "completed")');
  sheet.getRange('A6:E6').setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('E6').setNumberFormat('NT$ #,##0');

  // 各設計師當月業績排行 (區塊 B)
  sheet.getRange('A9').setValue('💈 本月各設計師業績統計 (動態本月)').setFontWeight('bold').setFontSize(13);
  sheet.getRange('A10:D10').setValues([['設計師', '完成人次', '累計實收營業額', '平均客單價']])
    .setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  // 使用 QUERY 動態匹配本月 yyyy-MM
  var queryFormula = '=QUERY(\'預約紀錄\'!A:Q, "select E, count(A), sum(P), avg(P) where J=\'completed\' and C starts with \'" & TEXT(TODAY(), "yyyy-MM") & "\' group by E label E \'\', count(A) \'\', sum(P) \'\', avg(P) \'\'", 0)';
  sheet.getRange('A11').setFormula(queryFormula);
  sheet.getRange('C11:D30').setNumberFormat('NT$ #,##0');

  // 熱門剪髮項目排行 (區塊 C，移至 A35 避免設計師超過 9 人時產生 #REF! 衝突)
  sheet.getRange('A35').setValue('✂️ 熱門服務項目排行 (當月)').setFontWeight('bold').setFontSize(13);
  sheet.getRange('A36:C36').setValues([['服務項目', '接單次數', '服務總營收']])
    .setBackground('#4a5568').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  var serviceQuery = '=QUERY(\'預約紀錄\'!A:Q, "select F, count(A), sum(P) where J=\'completed\' and C starts with \'" & TEXT(TODAY(), "yyyy-MM") & "\' group by F order by count(A) desc label F \'\', count(A) \'\', sum(P) \'\'", 0)';
  sheet.getRange('A37').setFormula(serviceQuery);
  sheet.getRange('C37:C60').setNumberFormat('NT$ #,##0');

  // 調整欄寬
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 160);

  SpreadsheetApp.flush();
  ss.setActiveSheet(sheet);
  ss.toast('營運即時看板已更新！', '📊 刷新成功', 5);
}

/**
 * [選單功能 2] 即時寄送今日打烊結算信給店長
 */
function sendDailyClosingReportNow() {
  var ui = SpreadsheetApp.getUi();
  var recipient = CONFIG.ADMIN_EMAIL() || Session.getEffectiveUser().getEmail();
  
  var confirm = ui.alert(
    '📧 即時寄送今日結算日報',
    '即將統計今日營業額與各設計師業績，並發送 HTML 日報至：\n' + recipient + '\n\n是否立即寄送？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  try {
    sendDailyClosingEmail(getTodayTW(), recipient);
    ui.alert('✅ 寄送成功', '今日結算日報已成功寄達：\n' + recipient, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('❌ 寄送失敗', '錯誤訊息：' + err.toString(), ui.ButtonSet.OK);
  }
}

/**
 * 統計特定日期的營業數據並發送 Email
 */
function sendDailyClosingEmail(dateStr, recipient) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();

  var totalBookings = 0;
  var completedCount = 0;
  var confirmedPending = 0;
  var cancelledCount = 0;
  var totalRevenue = 0;
  var stylistStats = {}; // name -> { count, revenue }

  for (var i = 1; i < data.length; i++) {
    var rowDate = formatDateCell(data[i][2]);
    if (rowDate !== dateStr) continue;

    var status = data[i][9];
    var stylist = data[i][4] || '未指定';
    var actualPrice = getAppointmentPrice(data[i]);

    totalBookings++;
    if (status === 'completed') {
      completedCount++;
      totalRevenue += actualPrice;
      if (!stylistStats[stylist]) stylistStats[stylist] = { count: 0, revenue: 0 };
      stylistStats[stylist].count++;
      stylistStats[stylist].revenue += actualPrice;
    } else if (status === 'confirmed') {
      confirmedPending++;
    } else if (status === 'cancelled') {
      cancelledCount++;
    }
  }

  var salon = escapeHtml(CONFIG.SALON_NAME());
  var subject = '📊 [' + CONFIG.SALON_NAME() + ' 打烊日報] ' + dateStr + ' 總營業額 NT$ ' + totalRevenue.toLocaleString();

  var stylistRows = '';
  for (var st in stylistStats) {
    stylistRows += '<tr>' +
      '<td style="padding:8px; border-bottom:1px solid #edf2f7; font-weight:bold;">' + escapeHtml(st) + '</td>' +
      '<td style="padding:8px; border-bottom:1px solid #edf2f7; text-align:center;">' + stylistStats[st].count + ' 位</td>' +
      '<td style="padding:8px; border-bottom:1px solid #edf2f7; text-align:right; font-weight:bold; color:#2D5016;">NT$ ' + stylistStats[st].revenue.toLocaleString() + '</td>' +
    '</tr>';
  }
  if (!stylistRows) {
    stylistRows = '<tr><td colspan="3" style="padding:12px; text-align:center; color:#a0aec0;">今日尚無已結帳之完成預約</td></tr>';
  }

  var htmlBody = '' +
    '<div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:24px; border:1px solid #e2e8f0; border-radius:16px; background-color:#ffffff;">' +
      '<div style="border-bottom:2px solid #2D5016; padding-bottom:16px; margin-bottom:20px;">' +
        '<h2 style="color:#2D5016; margin:0 0 4px 0;">' + salon + ' 營運日結清單</h2>' +
        '<p style="color:#718096; margin:0; font-size:13px;">結算日期：' + dateStr + '</p>' +
      '</div>' +

      '<div style="display:flex; gap:12px; margin-bottom:20px;">' +
        '<div style="flex:1; background-color:#f7fafc; padding:12px; border-radius:12px; text-align:center;">' +
          '<div style="color:#718096; font-size:12px;">今日總營收</div>' +
          '<div style="color:#2D5016; font-size:22px; font-weight:bold; margin-top:4px;">NT$ ' + totalRevenue.toLocaleString() + '</div>' +
        '</div>' +
        '<div style="flex:1; background-color:#f7fafc; padding:12px; border-radius:12px; text-align:center;">' +
          '<div style="color:#718096; font-size:12px;">已結帳人次</div>' +
          '<div style="color:#2b6cb0; font-size:22px; font-weight:bold; margin-top:4px;">' + completedCount + ' / ' + totalBookings + '</div>' +
        '</div>' +
      '</div>' +

      '<table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px;">' +
        '<tr><td style="color:#718096; padding:4px 0;">待確認/未結帳人次：</td><td style="font-weight:bold;">' + confirmedPending + ' 筆</td></tr>' +
        '<tr><td style="color:#718096; padding:4px 0;">取消人次：</td><td style="font-weight:bold; color:#c53030;">' + cancelledCount + ' 筆</td></tr>' +
      '</table>' +

      '<h3 style="font-size:15px; color:#2d3748; margin-bottom:8px;">💈 各設計師業績明細</h3>' +
      '<table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:24px;">' +
        '<tr style="background-color:#edf2f7; color:#4a5568;">' +
          '<th style="padding:8px; text-align:left;">設計師</th>' +
          '<th style="padding:8px; text-align:center;">完成人數</th>' +
          '<th style="padding:8px; text-align:right;">實收業績</th>' +
        '</tr>' +
        stylistRows +
      '</table>' +

      '<div style="text-align:center; padding-top:16px; border-top:1px solid #edf2f7; color:#a0aec0; font-size:12px;">' +
        '本信件由 ' + salon + ' 預約系統自動結算產生<br>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting' +
      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody
  });
}

/**
 * [選單功能 3] 彈窗查詢指定月份營運結算摘要
 */
function queryMonthlySummaryDialog() {
  var ui = SpreadsheetApp.getUi();
  var defaultMonth = getTodayTW().substring(0, 7);

  var prompt = ui.prompt(
    '📑 查詢月份結算摘要',
    '請輸入欲結算的月份 (格式：YYYY-MM)：',
    ui.ButtonSet.OK_CANCEL
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  var monthInput = (prompt.getResponseText() || '').trim();
  if (!monthInput.match(/^\d{4}-\d{2}$/)) {
    ui.alert('❌ 格式錯誤', '月份格式必須為 YYYY-MM（例如：' + defaultMonth + '）', ui.ButtonSet.OK);
    return;
  }

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();

  var totalCount = 0;
  var completedCount = 0;
  var totalRevenue = 0;
  var stylistMap = {};

  for (var i = 1; i < data.length; i++) {
    var rowDate = formatDateCell(data[i][2]);
    if (rowDate.indexOf(monthInput) !== 0) continue;

    var status = data[i][9];
    var stylist = data[i][4] || '未指定';
    var actualPrice = getAppointmentPrice(data[i]);

    totalCount++;
    if (status === 'completed') {
      completedCount++;
      totalRevenue += actualPrice;
      if (!stylistMap[stylist]) stylistMap[stylist] = { count: 0, revenue: 0 };
      stylistMap[stylist].count++;
      stylistMap[stylist].revenue += actualPrice;
    }
  }

  var summaryText = '【' + monthInput + ' 營運結算】\n\n' +
                    '💰 總實收營收：NT$ ' + totalRevenue.toLocaleString() + '\n' +
                    '👥 完成結帳人次：' + completedCount + ' / 總預約 ' + totalCount + ' 筆\n\n' +
                    '💈 各設計師業績統計：\n';

  var hasStylist = false;
  for (var s in stylistMap) {
    hasStylist = true;
    summaryText += '• ' + s + '：' + stylistMap[s].count + ' 位 / NT$ ' + stylistMap[s].revenue.toLocaleString() + '\n';
  }
  if (!hasStylist) summaryText += '（該月份尚無結帳完成之預約）\n';

  ui.alert('📊 ' + monthInput + ' 結算結果', summaryText, ui.ButtonSet.OK);
}

/**
 * [選單功能 4] 為尚未綁定 LINE 的設計師產生安全 8 碼金鑰 [P1 強化]
 */
function generateStylistBindingCodes() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
  upgradeSheetColumns(); // 確保第 6, 7, 8 欄位存在

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = sheet.getDataRange().getValues();
    var generated = [];

    for (var i = 1; i < data.length; i++) {
      var name = data[i][0];
      var lineUid = (data[i][5] || '').toString().trim();
      var existingCode = (data[i][7] || '').toString().trim();

      // 尚未綁定 LINE UID
      if (name && !lineUid) {
        var code = existingCode;
        if (!code) {
          // 產生安全 8 碼英數隨機金鑰 (例 HS-A8C3F2B1，組合空間超過 42 億種)
          code = 'HS-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
          sheet.getRange(i + 1, 8).setValue(code);
        }
        generated.push('• ' + name + ' ➔ 請於手機 LINE 輸入：綁定 ' + code);
      }
    }

    if (generated.length === 0) {
      ui.alert('🔑 設計師名單狀態', '目前所有設計師皆已完成 LINE 綁定！無需產生金鑰。', ui.ButtonSet.OK);
      return;
    }

    ui.alert(
      '🔑 設計師 LINE 綁定邀請碼 (一次性安全金鑰)',
      '請將以下代碼傳給對應的設計師，請他們在理髮店 LINE 官方帳號輸入：\n\n' + generated.join('\n\n') + '\n\n💡 設計師在手機發送後即刻綁定，金鑰會自動銷毀。',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('❌ 產生失敗', '系統忙碌中，請稍後再試：' + e.toString(), ui.ButtonSet.OK);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * [選單功能 5] 預約提醒檢查與推播測試 (安全 Dry-run 預覽模式)
 */
function previewAndTestReminders() {
  var ui = SpreadsheetApp.getUi();
  var today = getTodayTW();
  var tomorrow = addDays(today, 1);
  var usedQuota = getLineMonthlyPushConsumption();

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();

  var pending24h = 0;
  var pending1h = 0;

  var now = new Date();
  var nowMin = parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH'), 10) * 60 + parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'mm'), 10);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var date = formatDateCell(row[2]);
    var time = formatTimeCell(row[3]);
    var status = row[9];
    var sent24 = row[12];
    var sent1 = row[13];

    if (status !== 'confirmed') continue;

    if (date === tomorrow && !sent24) pending24h++;
    if (date === today && !sent1) {
      var apptMin = timeToMinutes(time);
      var diff = apptMin - nowMin;
      if (diff >= 53 && diff <= 67) pending1h++;
    }
  }

  var msg = '【LINE 主動推播狀態預覽】\n\n' +
            '📊 本月已用 Push 額度：' + (usedQuota >= 900 ? '無法取得(或異常)' : (usedQuota + ' / 200 則')) + '\n' +
            '🔔 待發送 24h 明日提醒：' + pending24h + ' 則\n' +
            '⏰ 待發送 1h 即將到店提醒：' + pending1h + ' 則\n\n' +
            '是否確定要立即執行一次排程檢查並真正發送推播？';

  var confirm = ui.alert('⏰ 預約提醒檢查', msg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  sendBookingReminders();
  ui.alert('✅ 執行完畢', '提醒排程檢查已完成！', ui.ButtonSet.OK);
}

/**
 * 試算表開啟時自動建立「✂️ 理髮店系統」管理選單
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('✂️ 理髮店系統')
    .addSubMenu(
      ui.createMenu('📊 報表與帳務結算')
        .addItem('📈 產生 / 重新整理營運報表', 'buildOrRefreshReportsSheet')
        .addItem('📧 即時寄送今日打烊結算信', 'sendDailyClosingReportNow')
        .addItem('📑 查詢指定月份結算摘要', 'queryMonthlySummaryDialog')
    )
    .addSeparator()
    .addItem('🔑 產生設計師 LINE 綁定碼', 'generateStylistBindingCodes')
    .addItem('⏰ 預約提醒檢查與推播測試 (預覽)', 'previewAndTestReminders')
    .addSeparator()
    .addItem('🔧 檢查 / 升級資料庫欄位', 'upgradeSheetColumns')
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
      '狀態', '取消者', '備註', '24h提醒', '1h提醒',
      '定價', '實收金額', '結帳時間'
    ]);
    sheet.getRange(1, 1, 1, 17).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    // 設定狀態欄下拉驗證
    setupStatusDataValidation(sheet);
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
    sheet.appendRow(['設計師姓名', '狀態(啟用/停用)', '上班星期(0-6逗號分開)', '上班時間', '下班時間', 'LINE UID', '角色(owner/stylist)', '綁定碼']);
    sheet.getRange(1, 1, 1, 8).setBackground('#2D5016').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.appendRow(['店長 Leo', '啟用', '1,2,3,4,5,6', '10:00', '20:00', '', 'owner', '']);
    sheet.appendRow(['設計師 Kelly', '啟用', '2,3,4,5,6,0', '11:00', '19:00', '', 'stylist', '']);
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

/** 依服務名稱查詢官方定價 */
function getOfficialServicePrice(serviceName) {
  var services = getActiveServices();
  for (var i = 0; i < services.length; i++) {
    if (services[i].name === serviceName) {
      return parseInt(services[i].price || '0', 10);
    }
  }
  return 0;
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
  var token = CONFIG.CHANNEL_ACCESS_TOKEN();
  if (!token) {
    console.error('replyMessage error: LINE_CHANNEL_ACCESS_TOKEN is missing in Script Properties!');
    return;
  }

  var url = 'https://api.line.me/v2/bot/message/reply';
  var payload = { replyToken: replyToken, messages: messages };
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var res = UrlFetchApp.fetch(url, options);
  var resCode = res.getResponseCode();
  if (resCode !== 200) {
    console.error('replyMessage HTTP ' + resCode + ' error: ' + res.getContentText());
  } else {
    console.log('replyMessage success');
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

// ============================================================
// 十一、設計師與店長 LINE 聊天室指令實作
// ============================================================

/** 依 LINE UID 查詢設計師或店長身份 */
function getStaffInfoByUid(uid) {
  if (!uid) return null;
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    var status = data[i][1];
    var lineUid = (data[i][5] || '').toString().trim();
    var role = (data[i][6] || 'stylist').toString().trim(); // 'owner' | 'stylist'
    if (status === '啟用' && lineUid === uid) {
      return { name: name, role: role, rowIndex: i + 1 };
    }
  }
  return null;
}

/** 處理設計師金鑰綁定 (例：綁定 HS-A8C3F2B1) */
function handleStylistBinding(replyToken, userId, code) {
  if (!code) {
    replyMessage(replyToken, [{ type: 'text', text: '請輸入正確的綁定格式，例如：綁定 HS-A8C3F2B1' }]);
    return;
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.STYLISTS);
    var data = sheet.getDataRange().getValues();
    var matchedRow = -1;
    var staffName = '';
    var staffRole = '';

    for (var i = 1; i < data.length; i++) {
      var storedCode = (data[i][7] || '').toString().trim();
      if (storedCode && storedCode.toUpperCase() === code.toUpperCase()) {
        matchedRow = i + 1;
        staffName = data[i][0];
        staffRole = data[i][6] || '設計師';
        break;
      }
    }

    if (matchedRow === -1) {
      replyMessage(replyToken, [{ type: 'text', text: '❌ 綁定失敗：無效的金鑰碼。請向店長索取正確的綁定碼！' }]);
      return;
    }

    // 寫入 LINE UID 並清空一次性綁定碼
    sheet.getRange(matchedRow, 6).setValue(userId);
    sheet.getRange(matchedRow, 8).setValue('');

    var roleName = staffRole === 'owner' ? '👑 店長' : '💇 設計師';
    replyMessage(replyToken, [{
      type: 'text',
      text: '🎉 恭喜 ' + staffName + '（' + roleName + '）身分綁定成功！\n\n' +
            '您現在可以使用專屬指令：\n' +
            '• 「今日行程」：查看今日預約名單\n' +
            '• 「明日行程」：查看明日預約名單\n' +
            '• 「我的業績」：查詢本月累計業績\n' +
            '• 「完成」：一鍵完成客人結帳\n' +
            (staffRole === 'owner' ? '• 「日報」：全店今日營運與業績總結\n' : '')
    }]);

  } catch (err) {
    console.error('handleStylistBinding error: ' + err);
    replyMessage(replyToken, [{ type: 'text', text: '系統忙碌中，請稍後再試。' }]);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 顯示設計師特定日期的行程清單 */
function showStaffSchedule(replyToken, staff, dateStr, label) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  var myAppts = [];

  for (var i = 1; i < data.length; i++) {
    var rowDate = formatDateCell(data[i][2]);
    var rowStylist = data[i][4];
    var status = data[i][9];

    if (rowDate === dateStr && status !== 'cancelled') {
      if (rowStylist === staff.name || rowStylist === '不限設計師') {
        myAppts.push({
          time: formatTimeCell(data[i][3]),
          customer: data[i][7],
          service: data[i][5],
          duration: data[i][6],
          price: data[i][15] || data[i][14] || 0,
          status: status,
          code: data[i][0]
        });
      }
    }
  }

  if (myAppts.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '💇 ' + staff.name + ' 您好：\n' + label + ' (' + dateStr + ') 暫無任何預約行程！好好放鬆一下吧 😊' }]);
    return;
  }

  myAppts.sort(function(a, b) { return a.time.localeCompare(b.time); });

  var lines = myAppts.map(function(item, idx) {
    var stLabel = item.status === 'completed' ? ' [已結帳]' : '';
    return (idx + 1) + '. ' + item.time + ' - ' + item.customer + '\n' +
           '   項目：' + item.service + ' (' + item.duration + '分) · NT$' + item.price + stLabel + '\n' +
           '   編號：' + item.code;
  });

  replyMessage(replyToken, [{
    type: 'text',
    text: '💈 ' + staff.name + ' 的' + label + '行程 (' + dateStr + ' 共 ' + myAppts.length + ' 位)：\n\n' + lines.join('\n\n')
  }]);
}

/** 顯示設計師個人本月業績 */
function showStaffRevenue(replyToken, staff) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  var currentMonth = getTodayTW().substring(0, 7);

  var totalCount = 0;
  var totalRevenue = 0;

  for (var i = 1; i < data.length; i++) {
    var rowDate = formatDateCell(data[i][2]);
    var rowStylist = data[i][4];
    var status = data[i][9];

    if (rowDate.indexOf(currentMonth) === 0 && rowStylist === staff.name && status === 'completed') {
      totalCount++;
      totalRevenue += getAppointmentPrice(data[i]);
    }
  }

  replyMessage(replyToken, [{
    type: 'text',
    text: '💰 ' + staff.name + ' 本月份業績統計 (' + currentMonth + ')：\n\n' +
          '• 已結帳完成人次：' + totalCount + ' 位\n' +
          '• 累計實收營業額：NT$ ' + totalRevenue.toLocaleString() + ' 元\n\n' +
          '辛苦了！繼續加油 ✂️'
  }]);
}

/** 結帳提示：列出今日未結帳的客人供設計師點選完成 */
function promptCompleteBooking(replyToken, staff) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();
  var today = getTodayTW();
  var pendingList = [];

  for (var i = 1; i < data.length; i++) {
    var code = (data[i][0] || '').toString();
    var rowDate = formatDateCell(data[i][2]);
    var rowStylist = data[i][4];
    var status = data[i][9];

    // [P1-5 修正] 排除公休佔位列 (以 OFF- 開頭者)
    if (code.indexOf('OFF-') === 0) continue;

    if (rowDate === today && status === 'confirmed') {
      if (staff.role === 'owner' || rowStylist === staff.name || rowStylist === '不限設計師') {
        pendingList.push({
          code: code,
          time: formatTimeCell(data[i][3]),
          customer: data[i][7],
          service: data[i][5]
        });
      }
    }
  }

  if (pendingList.length === 0) {
    replyMessage(replyToken, [{ type: 'text', text: '今日沒有未結帳的待服務預約！' }]);
    return;
  }

  // [P1-4 修正] 使用 truncateUnicode 避免截斷 Emoji
  var items = pendingList.slice(0, 13).map(function(apt) {
    var label = truncateUnicode(apt.time + ' ' + apt.customer, 20);
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: label,
        data: 'action=COMPLETE_CONFIRM&code=' + apt.code,
        displayText: '完成 ' + apt.customer + ' (' + apt.time + ')'
      }
    };
  });

  replyWithQuickReply(replyToken, '請點選今日已完成服務的顧客進行結帳：', items);
}

/** 執行標記預約為 completed (結帳) [P0-2 安全加固] */
function handleCompleteConfirm(replyToken, userId, params) {
  var code = params['code'];
  if (!code) {
    replyMessage(replyToken, [{ type: 'text', text: '資料錯誤，結帳失敗。' }]);
    return;
  }

  // 1. 驗證身分：必須為系統登記的設計師或店長
  var staff = getStaffInfoByUid(userId);
  if (!staff) {
    replyMessage(replyToken, [{ type: 'text', text: '❌ 權限不足：您尚未綁定設計師或店長身分，無法執行結帳。' }]);
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
      if (data[i][0] === code) {
        targetRow = i + 1;
        aptInfo = {
          code: data[i][0],
          date: formatDateCell(data[i][2]),
          stylist: data[i][4],
          service: data[i][5],
          customer: data[i][7],
          status: data[i][9],
          price: (data[i][15] !== '' && data[i][15] !== undefined) ? data[i][15] : (data[i][14] || 0)
        };
        break;
      }
    }

    if (targetRow === -1 || !aptInfo) {
      replyMessage(replyToken, [{ type: 'text', text: '找不到該筆預約紀錄。' }]);
      return;
    }

    // 2. 狀態檢查：僅有待服務 (confirmed) 的預約能結帳，防止重複結帳或結帳已取消的預約
    if (aptInfo.status !== 'confirmed') {
      replyMessage(replyToken, [{ type: 'text', text: '此預約目前的狀態為「' + aptInfo.status + '」，無法重複結帳！' }]);
      return;
    }

    // 3. 權限檢查：設計師只能結自己的客人（或不限設計師的客人）；店長則可替所有人結帳
    if (staff.role !== 'owner' && aptInfo.stylist !== staff.name && aptInfo.stylist !== '不限設計師') {
      replyMessage(replyToken, [{ type: 'text', text: '此筆預約指定的是「' + aptInfo.stylist + '」，您無法跨人結帳。' }]);
      return;
    }

    // 4. 不限設計師歸屬：若原預約為「不限設計師」，完成時自動改為實際服務該顧客的設計師
    var finalStylist = aptInfo.stylist;
    if (aptInfo.stylist === '不限設計師') {
      finalStylist = staff.name;
      sheet.getRange(targetRow, 5).setValue(finalStylist);
    }

    // 標記為 completed 並記錄結帳時間
    var nowStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(targetRow, 10).setValue('completed');
    sheet.getRange(targetRow, 17).setValue(nowStr);

    replyMessage(replyToken, [{
      type: 'text',
      text: '✅ 結帳完成！\n\n' +
            '顧客：' + aptInfo.customer + '\n' +
            '服務：' + aptInfo.service + '\n' +
            '設計師：' + finalStylist + '\n' +
            '實收金額：NT$ ' + aptInfo.price + '\n' +
            '完成時間：' + nowStr
    }]);

  } catch (err) {
    console.error('handleCompleteConfirm error: ' + err);
    replyMessage(replyToken, [{ type: 'text', text: '結帳失敗，請稍後再試。' }]);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * [定時排程] 每日打烊結算通知 (供 GAS Trigger 每晚 21:00 定時呼叫，無參數)
 */
function dailyClosingReportScheduled() {
  var recipient = CONFIG.ADMIN_EMAIL();
  if (!recipient) {
    try { recipient = Session.getEffectiveUser().getEmail(); } catch (e) {}
  }
  if (!recipient) {
    console.warn('dailyClosingReportScheduled: No admin email set.');
    return;
  }

  // 冪等防重複：若今日已寄過打烊信則略過
  var today = getTodayTW();
  var sentKey = 'DAILY_CLOSED_SENT_' + today;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(sentKey)) {
    console.log('Daily closing report already sent for ' + today);
    return;
  }

  try {
    sendDailyClosingEmail(today, recipient);
    props.setProperty(sentKey, 'true');
    console.log('Daily closing report sent successfully for ' + today);
  } catch (err) {
    console.error('Failed to send scheduled daily closing report: ' + err);
  }
}

/** 統一取得預約列之實收金額 (若實收欄非空則優先採用，包含 NT$ 0，否則取定價) */
function getAppointmentPrice(row) {
  if (!row) return 0;
  // 欄 16 (index 15): 實收金額；欄 15 (index 14): 定價
  if (row[15] !== '' && row[15] !== undefined && row[15] !== null) {
    return parseFloat(row[15]) || 0;
  }
  if (row[14] !== '' && row[14] !== undefined && row[14] !== null) {
    return parseFloat(row[14]) || 0;
  }
  return 0;
}

/** 避免 Google 試算表公式注入攻擊 (若以 =, +, -, @ 開頭則前綴 ') */
function sanitizeFormulaInput(input) {
  if (!input) return '';
  var str = input.toString().trim();
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/** 店長在 LINE 輸入「日報」即時查詢全店今日概況 */
function showOwnerDailySummary(replyToken, dateStr) {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.APPOINTMENTS);
  var data = sheet.getDataRange().getValues();

  var totalBookings = 0;
  var completedCount = 0;
  var confirmedPending = 0;
  var cancelledCount = 0;
  var totalRevenue = 0;
  var stylistStats = {};

  for (var i = 1; i < data.length; i++) {
    var rowDate = formatDateCell(data[i][2]);
    if (rowDate !== dateStr) continue;

    var status = data[i][9];
    var stylist = data[i][4] || '未指定';
    var actualPrice = getAppointmentPrice(data[i]);

    totalBookings++;
    if (status === 'completed') {
      completedCount++;
      totalRevenue += actualPrice;
      if (!stylistStats[stylist]) stylistStats[stylist] = { count: 0, revenue: 0 };
      stylistStats[stylist].count++;
      stylistStats[stylist].revenue += actualPrice;
    } else if (status === 'confirmed') {
      confirmedPending++;
    } else if (status === 'cancelled') {
      cancelledCount++;
    }
  }

  var msg = '📊 【全店今日日報 (' + dateStr + ')】\n\n' +
            '💰 今日總營業額：NT$ ' + totalRevenue.toLocaleString() + ' 元\n' +
            '👥 今日總預約人次：' + totalBookings + ' 筆\n' +
            '  • 已結帳完成：' + completedCount + ' 位\n' +
            '  • 待服務/未結帳：' + confirmedPending + ' 位\n' +
            '  • 已取消：' + cancelledCount + ' 筆\n\n' +
            '💈 設計師業績分佈：\n';

  var hasStylist = false;
  for (var st in stylistStats) {
    hasStylist = true;
    msg += '• ' + st + '：' + stylistStats[st].count + ' 位 (NT$ ' + stylistStats[st].revenue.toLocaleString() + ')\n';
  }
  if (!hasStylist) msg += '（尚無完成結帳紀錄）\n';

  replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

