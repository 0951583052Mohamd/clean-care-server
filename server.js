const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ===============================
// الاتصال بـ Supabase
// ===============================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("خطأ: بيانات Supabase غير موجودة في ملف .env");
  process.exit(1);
}

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ===============================
// التحقق من المدير
// ===============================

async function verifyAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "يجب تسجيل الدخول أولاً"
      });
    }

    const token = authHeader.substring(7);

    const {
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({
        success: false,
        message: "جلسة تسجيل الدخول غير صالحة"
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role, active")
        .eq("id", user.id)
        .single();

    if (
      profileError ||
      !profile ||
      profile.role !== "admin" ||
      profile.active !== true
    ) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية لتنفيذ هذه العملية"
      });
    }

    req.currentUser = user;
    next();

  } catch (error) {
    console.error("خطأ التحقق من المدير:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء التحقق من الصلاحية"
    });
  }
}

// ===============================
// الصفحة الرئيسية
// ===============================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Clean & Care Server يعمل بشكل صحيح"
  });
});

// ===============================
// إنشاء حساب مستخدم جديد
// ===============================

app.post("/admin/create-user", verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      username,
      password,
      active,
      permissions,
      reminderReports,
      completionReports,
      photo
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "اسم المستخدم مطلوب"
      });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: "البريد الإلكتروني مطلوب"
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const {
      data: authData,
      error: authError
    } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: String(password),
      email_confirm: true
    });

    if (authError || !authData.user) {
      console.error("خطأ إنشاء الحساب:", authError);

      return res.status(400).json({
        success: false,
        message: authError?.message || "تعذر إنشاء الحساب"
      });
    }

    const userId = authData.user.id;

    const { error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .insert({
          id: userId,
          name: String(name).trim(),
          email: cleanEmail,
          phone: phone ? String(phone).trim() : null,
          photo: photo || null,
          active: active !== false,
          permissions: Array.isArray(permissions) ? permissions : [],
          reminder_reports: reminderReports === true,
          completion_reports: completionReports === true,
          role: "user"
        });

    if (profileError) {
      console.error("خطأ إنشاء الملف الشخصي:", profileError);

      await supabaseAdmin.auth.admin.deleteUser(userId);

      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء بيانات المستخدم"
      });
    }

    console.log("تم إنشاء حساب جديد:", cleanEmail);

    return res.json({
      success: true,
      message: "تم إنشاء الحساب بنجاح",
      user: {
        id: userId,
        name: String(name).trim(),
        email: cleanEmail,
        phone: phone || "",
        username: username || "",
        active: active !== false,
        permissions: Array.isArray(permissions) ? permissions : [],
        reminderReports: reminderReports === true,
        completionReports: completionReports === true,
        photo: photo || ""
      }
    });

  } catch (error) {
    console.error("خطأ إنشاء المستخدم:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء الحساب"
    });
  }
});

// ===============================
// رسالة اختبار
// ===============================

app.post("/test-message", (req, res) => {
  const { workerName, message } = req.body;

  if (!workerName || !message) {
    return res.status(400).json({
      success: false,
      message: "اسم العامل والرسالة مطلوبان"
    });
  }

  console.log("رسالة اختبار:");
  console.log("العامل:", workerName);
  console.log("الرسالة:", message);

  res.json({
    success: true,
    message: "تم استلام الرسالة من البرنامج",
    workerName,
    text: message
  });
});

// ===============================
// البيانات
// ===============================

let assignments = [];
let managers = [];

// ===============================
// تحميل المدراء
// ===============================

async function loadManagersFromSupabase() {
  try {
    const { data, error } =
      await supabaseAdmin
        .from("profiles")
        .select("id,name,phone,active");

    if (error) {
      console.error("خطأ تحميل المدراء:", error.message);
      return;
    }

    managers = (data || []).filter(manager =>
      manager.active === true &&
      manager.phone &&
      String(manager.phone).trim()
    );

    console.log(
      "تم تحميل المدراء المستلمين للتقارير:",
      managers.length
    );

  } catch (error) {
    console.error(
      "خطأ أثناء تحميل المدراء:",
      error
    );
  }
}

// ===============================
// تحميل المواعيد من Supabase
// ===============================

async function loadAssignmentsFromSupabase() {
  try {
    const {
      data: assignmentRows,
      error: assignmentsError
    } = await supabaseAdmin
      .from("hotel_assignments")
      .select("*");

    if (assignmentsError) {
      console.error(
        "خطأ تحميل مواعيد الفنادق:",
        assignmentsError.message
      );
      return;
    }

    const {
      data: workers,
      error: workersError
    } = await supabaseAdmin
      .from("workers")
      .select("id,name,phone");

    if (workersError) {
      console.error(
        "خطأ تحميل العمال:",
        workersError.message
      );
      return;
    }

    const {
      data: hotels,
      error: hotelsError
    } = await supabaseAdmin
      .from("hotels")
      .select("id,name");

    if (hotelsError) {
      console.error(
        "خطأ تحميل الفنادق:",
        hotelsError.message
      );
      return;
    }

    assignments = (assignmentRows || []).map(row => {
      const worker = (workers || []).find(
        item => String(item.id) === String(row.worker_id)
      );

      const hotel = (hotels || []).find(
        item => String(item.id) === String(row.hotel_id)
      );

      return {
        id: String(row.id),
        workerId: String(row.worker_id || ""),
        workerName: worker ? worker.name : "",
        workerPhone: worker ? worker.phone : "",
        placeId: String(row.hotel_id || ""),
        placeName: hotel ? hotel.name : "",
        placeType: "hotel",
        date: row.date || "",
        startTime: row.start_time || "",
        endTime: row.end_time || "",
        rooms: Array.isArray(row.rooms) ? row.rooms : [],
        roomCount: Number(row.room_count || 0),
        tasks: row.tasks || "",
        completed: Boolean(row.completed),
        delay: Number(row.delay || 0)
      };
    });

    console.log(
      "تم تحميل مواعيد الفنادق من Supabase:",
      assignments.length
    );

  } catch (error) {
    console.error(
      "خطأ أثناء تحميل المواعيد:",
      error
    );
  }
}

// ===============================
// التوافق مع صفحة العمال
// ===============================

app.post("/sync-assignments", async (req, res) => {
  await loadAssignmentsFromSupabase();

  res.json({
    success: true,
    message: "تم تحديث المواعيد من Supabase",
    count: assignments.length
  });
});

// ===============================
// منع تكرار الرسائل
// ===============================

const sentMessages = new Set();

function getKey(type, assignment) {
  return [
    type,
    assignment.id,
    assignment.date,
    assignment.startTime,
    assignment.endTime
  ].join("-");
}

// ===============================
// الغرف
// ===============================

function getRoomsText(assignment) {
  if (
    !Array.isArray(assignment.rooms) ||
    assignment.rooms.length === 0
  ) {
    return "لا يوجد";
  }

  return assignment.rooms
    .map(room => {
      if (
        typeof room === "string" ||
        typeof room === "number"
      ) {
        return String(room);
      }

      if (room && typeof room === "object") {
        return (
          room.number ||
          room.name ||
          room.roomNumber ||
          room.room ||
          ""
        );
      }

      return "";
    })
    .filter(Boolean)
    .join("، ") || "لا يوجد";
}

// ===============================
// المهام
// ===============================

function getTasksText(assignment) {
  if (
    assignment.tasks &&
    String(assignment.tasks).trim()
  ) {
    return String(assignment.tasks).trim();
  }

  return "لا توجد مهام إضافية";
}

// ===============================
// مدة العمل
// ===============================

function getWorkDuration(assignment) {
  if (
    !assignment.date ||
    !assignment.startTime ||
    !assignment.endTime
  ) {
    return "غير محددة";
  }

  const start = new Date(
    `${assignment.date}T${assignment.startTime}:00`
  );

  const end = new Date(
    `${assignment.date}T${assignment.endTime}:00`
  );

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return "غير محددة";
  }

  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  const totalMinutes =
    Math.round(
      (end.getTime() - start.getTime()) / 60000
    );

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ساعة و ${minutes} دقيقة`;
  }

  if (hours > 0) {
    return `${hours} ساعة`;
  }

  return `${minutes} دقيقة`;
}

// ===============================
// تذكير العامل
// ===============================

function sendWorkerReminder(assignment) {
  const workerName =
    assignment.workerName || "العامل";

  const workerPhone =
    assignment.workerPhone || "غير موجود";

  const placeName =
    assignment.placeName || "غير محدد";

  const startTime =
    assignment.startTime || "غير محدد";

  const rooms = getRoomsText(assignment);
  const tasks = getTasksText(assignment);

  const message = [
    `مرحباً ${workerName}،`,
    "",
    "تذكير بموعد عملك اليوم.",
    "",
    `🏨 المكان: ${placeName}`,
    `🕐 وقت البداية: ${startTime}`,
    `🚪 الغرف: ${rooms}`,
    `📝 المهام: ${tasks}`,
    "",
    "Clean & Care"
  ].join("\n");

  console.log("");
  console.log("================================");
  console.log("📱 تذكير العامل قبل العمل بـ 30 دقيقة");
  console.log("الهاتف:", workerPhone);
  console.log("--------------------------------");
  console.log(message);
  console.log("================================");
  console.log("");

  // لاحقاً: إرسال WhatsApp للعامل

  return message;
}

// ===============================
// إرسال التقرير لكل المدراء
// ===============================

function sendReportToAllManagers(title, message) {

  console.log("");
  console.log("================================");
  console.log(title);

  if (managers.length === 0) {
    console.log("لا يوجد مدير مفعّل لديه رقم هاتف");
    console.log("--------------------------------");
    console.log(message);
  } else {
    managers.forEach(manager => {
      console.log("--------------------------------");
      console.log(
        "المدير:",
        manager.name || "بدون اسم"
      );
      console.log(
        "الهاتف:",
        manager.phone
      );
      console.log(message);

      // لاحقاً:
      // هنا سيتم إرسال WhatsApp لهذا المدير
    });
  }

  console.log("================================");
  console.log("");
}

// ===============================
// تقرير بداية العمل
// ===============================

function sendManagerStartReport(assignment) {

  const workerName =
    assignment.workerName || "غير محدد";

  const placeName =
    assignment.placeName || "غير محدد";

  const startTime =
    assignment.startTime || "غير محدد";

  const rooms = getRoomsText(assignment);
  const tasks = getTasksText(assignment);

  const message = [
    "🟢 بدء العمل – Clean & Care",
    "",
    `👷 العامل: ${workerName}`,
    `🏨 المكان: ${placeName}`,
    `🕐 وقت البداية: ${startTime}`,
    `🚪 الغرف: ${rooms}`,
    `📝 المهام: ${tasks}`
  ].join("\n");

  sendReportToAllManagers(
    "📋 تقرير بداية العمل لجميع المدراء",
    message
  );

  return message;
}

// ===============================
// تقرير انتهاء العمل
// ===============================

function sendManagerEndReport(assignment) {

  const workerName =
    assignment.workerName || "غير محدد";

  const placeName =
    assignment.placeName || "غير محدد";

  const startTime =
    assignment.startTime || "غير محدد";

  const endTime =
    assignment.endTime || "غير محدد";

  const rooms = getRoomsText(assignment);
  const duration = getWorkDuration(assignment);

  const message = [
    "🔴 انتهاء العمل – Clean & Care",
    "",
    `👷 العامل: ${workerName}`,
    `🏨 المكان: ${placeName}`,
    `🕐 البداية: ${startTime}`,
    `🕐 النهاية: ${endTime}`,
    `⏱️ مدة العمل: ${duration}`,
    `🚪 الغرف: ${rooms}`
  ].join("\n");

  sendReportToAllManagers(
    "📋 تقرير انتهاء العمل لجميع المدراء",
    message
  );

  return message;
}

// ===============================
// فحص المواعيد
// ===============================

async function checkAssignments() {

  await Promise.all([
    loadAssignmentsFromSupabase(),
    loadManagersFromSupabase()
  ]);

  const now = new Date();

  assignments.forEach((assignment) => {

    if (
      !assignment.id ||
      !assignment.date ||
      !assignment.startTime ||
      !assignment.endTime
    ) {
      return;
    }

    const start = new Date(
      `${assignment.date}T${assignment.startTime}:00`
    );

    const end = new Date(
      `${assignment.date}T${assignment.endTime}:00`
    );

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return;
    }

    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }

    const reminder = new Date(
      start.getTime() - 30 * 60 * 1000
    );

    const differenceFromReminder =
      now.getTime() - reminder.getTime();

    const differenceFromStart =
      now.getTime() - start.getTime();

    const differenceFromEnd =
      now.getTime() - end.getTime();

    const reminderKey =
      getKey("worker-reminder", assignment);

    const startKey =
      getKey("manager-start", assignment);

    const endKey =
      getKey("manager-end", assignment);

    // تذكير العامل
    if (
      differenceFromReminder >= 0 &&
      differenceFromReminder < 60000 &&
      !sentMessages.has(reminderKey)
    ) {
      sendWorkerReminder(assignment);
      sentMessages.add(reminderKey);
    }

    // تقرير البداية لجميع المدراء
    if (
      differenceFromStart >= 0 &&
      differenceFromStart < 60000 &&
      !sentMessages.has(startKey)
    ) {
      sendManagerStartReport(assignment);
      sentMessages.add(startKey);
    }

    // تقرير النهاية لجميع المدراء
    if (
      differenceFromEnd >= 0 &&
      differenceFromEnd < 60000 &&
      !sentMessages.has(endKey)
    ) {
      sendManagerEndReport(assignment);
      sentMessages.add(endKey);
    }
  });
}

// ===============================
// الفحص كل 10 ثواني
// ===============================

setInterval(() => {
  checkAssignments().catch(error => {
    console.error(
      "خطأ في نظام التذكير:",
      error
    );
  });
}, 10000);

// ===============================
// تشغيل السيرفر
// ===============================

app.listen(PORT, async () => {

  console.log(
    `Clean & Care Server يعمل على http://localhost:${PORT}`
  );

  console.log("نظام التذكير التلقائي يعمل");
  console.log("Supabase متصل بالسيرفر");
  console.log("نظام إدارة الحسابات جاهز");

  await Promise.all([
    loadAssignmentsFromSupabase(),
    loadManagersFromSupabase()
  ]);

  console.log(
    "المواعيد والمدراء أصبحوا يُقرأون مباشرة من Supabase"
  );
});