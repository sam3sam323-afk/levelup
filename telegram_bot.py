import os
import threading
import logging
import re
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

# ==========================================
# 1. خادم الـ Health Check (لصالح Render و UptimeRobot)
# ==========================================
class HealthCheckHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, format, *args):
        return

def run_health_check_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(('0.0.0.0', port), HealthCheckHandler)
    server.serve_forever()

threading.Thread(target=run_health_check_server, daemon=True).start()

# ==========================================
# 2. إعدادات البوت والبيانات الأساسية
# ==========================================
BOT_TOKEN = os.environ.get("BOT_TOKEN")
ADMIN_ID = 6467163023

if not BOT_TOKEN:
    raise RuntimeError("لم يتم العثور على التوكن.")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

CHOOSING_DAY, CHOOSING_HOUR, WAITING_FOR_CONTACT = range(3)

WELCOME_TEXT = (
    "أهلًا بك في LEVEL UP ARENA 🎮\n\n"
    "اختر من القائمة الموجودة أسفل الشاشة للبدء:"
)

WARNING_NOTE = "⚠️ **تنبيه:** جميع الروابط رسمية ومضمونة لتجنب أي برامج معدلة وحماية الأجهزة والشبكة.\n\n"

DAYS_AR = {
    0: "الإثنين",
    1: "الثلاثاء",
    2: "الأربعاء",
    3: "الخميس",
    4: "الجمعة",
    5: "السبت",
    6: "الأحد",
}

def main_reply_keyboard() -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("🎮 حجز جهاز"), KeyboardButton("💰 الأسعار")],
        [KeyboardButton("🕒 أوقات الدوام"), KeyboardButton("📂 البرامج المتوفرة")],
        [KeyboardButton("💬 التواصل مع الإدارة")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

def software_categories_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [InlineKeyboardButton("1️⃣ المكتبة المختصرة والتعريفات", callback_data="soft_1")],
        [InlineKeyboardButton("2️⃣ حزم التشغيل وأدوات الضغط", callback_data="soft_2")],
        [InlineKeyboardButton("3️⃣ الميديا، الأداء والصيانة", callback_data="soft_3")],
        [InlineKeyboardButton("4️⃣ المتصفحات ومنصات الألعاب", callback_data="soft_4")],
        [InlineKeyboardButton("5️⃣ الشبكة، التواصل والتصميم", callback_data="soft_5")],
        [InlineKeyboardButton("6️⃣ الذكاء الاصطناعي ومتاجر الألعاب", callback_data="soft_6")],
    ]
    return InlineKeyboardMarkup(keyboard)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if update.message:
        await update.message.reply_text(
            WELCOME_TEXT, reply_markup=main_reply_keyboard()
        )
    return ConversationHandler.END

# --- نظام الحجز التفاعلي ---
async def booking_day_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    today = datetime.now()
    keyboard = []
    
    for i in range(6):
        d = today + timedelta(days=i)
        if i == 0:
            day_label = f"اليوم ({d.strftime('%m/%d')})"
        elif i == 1:
            day_label = f"غداً ({d.strftime('%m/%d')})"
        else:
            day_label = f"{DAYS_AR[d.weekday()]} ({d.strftime('%m/%d')})"
            
        callback_val = f"day_{d.strftime('%Y-%m-%d')}"
        keyboard.append([InlineKeyboardButton(day_label, callback_data=callback_val)])
    
    keyboard.append([InlineKeyboardButton("❌ إلغاء الحجز", callback_data="cancel_booking")])
    
    markup = InlineKeyboardMarkup(keyboard)
    text = "📅 **اختر يوم الحجز المطلوب:**"
    
    if update.message:
        await update.message.reply_text(text, reply_markup=markup, parse_mode="Markdown")
    elif update.callback_query:
        query = update.callback_query
        await query.answer()
        await query.edit_message_text(text, reply_markup=markup, parse_mode="Markdown")
        
    return CHOOSING_HOUR

async def booking_hour_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    
    data = query.data
    if data == "cancel_booking":
        await query.edit_message_text("تم إلغاء الحجز.", reply_markup=None)
        if update.effective_message:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="القائمة الرئيسية:",
                reply_markup=main_reply_keyboard()
            )
        return ConversationHandler.END

    if data.startswith("day_"):
        selected_date = data.replace("day_", "")
        context.user_data["booking_day"] = selected_date

    keyboard = [
        [
            InlineKeyboardButton("12:00 ظهراً", callback_data="hour_12pm"),
            InlineKeyboardButton("02:00 ظهراً", callback_data="hour_2pm"),
        ],
        [
            InlineKeyboardButton("04:00 عصراً", callback_data="hour_4pm"),
            InlineKeyboardButton("06:00 مساءً", callback_data="hour_6pm"),
        ],
        [
            InlineKeyboardButton("08:00 مساءً", callback_data="hour_8pm"),
            InlineKeyboardButton("10:00 ليلاً", callback_data="hour_10pm"),
        ],
        [InlineKeyboardButton("⬅️ الرجوع لتغيير اليوم", callback_data="back_to_days")],
    ]
    
    if data == "back_to_days":
        return await booking_day_start(update, context)

    day_text = context.user_data.get("booking_day", "")
    await query.edit_message_text(
        f"⏰ **التاريخ المختار: ({day_text})**\nاختر الساعة المناسبة لحجزك:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )
    return CHOOSING_DAY

async def booking_finish_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    
    data = query.data
    if data == "back_to_days":
        return await booking_day_start(update, context)
    
    hour_map = {
        "hour_12pm": "12:00 ظهراً",
        "hour_2pm": "02:00 ظهراً",
        "hour_4pm": "04:00 عصراً",
        "hour_6pm": "06:00 مساءً",
        "hour_8pm": "08:00 مساءً",
        "hour_10pm": "10:00 ليلاً"
    }
    hour_text = hour_map.get(data, "وقت غير محدد")
    day_text = context.user_data.get("booking_day", "غير محدد")
    
    user = query.from_user
    user_info = f"@{user.username}" if user.username else f"الاسم: {user.first_name}"
    
    await query.edit_message_text(
        f"✅ **تم تسجيل طلب الحجز بنجاح!**\n\n"
        f"📅 التاريخ: {day_text}\n"
        f"⏰ الساعة: {hour_text}\n\n"
        f"تم إرسال طلبك للإدارة وسيتم تأكيده قريباً.",
        parse_mode="Markdown"
    )
    await context.bot.send_message(
        chat_id=query.message.chat_id,
        text="اختر ما تحتاجه من القائمة أدناه:",
        reply_markup=main_reply_keyboard()
    )
    
    admin_msg = (
        f"🚨 **طلب حجز جهاز جديد في ليفل آب أرينا!**\n\n"
        f"👤 الزبون: {user_info} (ID: `{user.id}`)\n"
        f"📅 التاريخ: {day_text}\n"
        f"⏰ الساعة: {hour_text}"
    )
    try:
        await context.bot.send_message(chat_id=ADMIN_ID, text=admin_msg, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"فشل إرسال إشعار الحجز للأدمن: {e}")

    return ConversationHandler.END

# --- نظام التواصل مع الإدارة والرد عليها ---
async def contact_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = (
        "💬 **التواصل مع الإدارة**\n\n"
        "اكتب رسالتك أو استفسارك الآن في الشات، وسيتم إرسالها مباشرة إلى إدارة ليفل آب أرينا:"
    )
    if update.message:
        await update.message.reply_text(text, reply_markup=ReplyKeyboardRemove(), parse_mode="Markdown")
    elif update.callback_query:
        query = update.callback_query
        await query.answer()
        await query.edit_message_text(text, parse_mode="Markdown")
        
    return WAITING_FOR_CONTACT

async def receive_contact_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user = update.message.from_user
    text_content = update.message.text
    
    user_info = f"@{user.username}" if user.username else f"{user.first_name}"
    
    admin_msg = (
        f"📩 **رسالة جديدة من زبون (تواصل مع الإدارة):**\n\n"
        f"👤 المرسل: {user_info} (ID: `{user.id}`)\n"
        f"💬 النص:\n{text_content}"
    )
    
    try:
        await context.bot.send_message(chat_id=ADMIN_ID, text=admin_msg, parse_mode="Markdown")
        await update.message.reply_text(
            "✅ تم إرسال رسالتك إلى إدارة ليفل آب أرينا بنجاح! سيتم الرد عليك قريباً.",
            reply_markup=main_reply_keyboard()
        )
    except Exception as e:
        logger.error(f"فشل إرسال رسالة التواصل للأدمن: {e}")
        await update.message.reply_text("حدث خطأ أثناء إرسال الرسالة، حاول مرة أخرى لاحقاً.", reply_markup=main_reply_keyboard())

    return ConversationHandler.END

async def admin_direct_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """يتيح للأدمن الرد مباشرة على أي زبون عبر عمل Reply لرسالته."""
    if update.effective_user.id != ADMIN_ID:
        return

    reply_to = update.message.reply_to_message
    if not reply_to or not reply_to.text:
        return

    # استخراج الـ ID من الرسالة الأصلية التي وصلت للأدمن
    match = re.search(r"ID: `(\d+)`", reply_to.text)
    if match:
        customer_id = int(match.group(1))
        admin_text = update.message.text
        try:
            await context.bot.send_message(
                chat_id=customer_id,
                text=f"💬 **رد إدارة ليفل آب أرينا:**\n\n{admin_text}"
            )
            await update.message.reply_text("✅ تم إرسال الرد إلى الزبون بنجاح.")
        except Exception as e:
            logger.error(f"فشل إرسال الرد للزبون: {e}")
            await update.message.reply_text(f"❌ لم يتم إرسال الرد. الخطأ: {e}")

# --- معالجة أزرار القائمة الثابتة ---
async def handle_reply_keyboard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text

    if text == "🎮 حجز جهاز":
        return await booking_day_start(update, context)
    
    elif text == "💰 الأسعار":
        await update.message.reply_text(
            "💰 **قائمة الأسعار في ليفل آب أرينا:**\n\n"
            "• الساعة العادية: حسب العرض الحالي.\n"
            "• العروض الجماعية متوفرة في الصالة.\n\n"
            "للاستفسار عن العروض الخاصة، تواصل مع الإدارة مباشرة.",
            reply_markup=main_reply_keyboard(),
            parse_mode="Markdown"
        )
    
    elif text == "🕒 أوقات الدوام":
        await update.message.reply_text(
            "🕒 **أوقات الدوام:**\n\n"
            "يوميًا من الظهر وحتى ساعات متأخرة.\n"
            "زورنا في الصالة بـ (البودي) أهلاً بالجميع!",
            reply_markup=main_reply_keyboard(),
            parse_mode="Markdown"
        )
    
    elif text == "📂 البرامج المتوفرة":
        await update.message.reply_text(
            "📂 **مكتبة برامج وأدوات LEVEL UP ARENA الرسمية**\n\n"
            "اختر القسم المطلوب لعرض الروابط والتحميل المباشر:",
            reply_markup=software_categories_keyboard(),
            parse_mode="Markdown"
        )
    
    elif text == "💬 التواصل مع الإدارة":
        return await contact_prompt(update, context)
        
    return ConversationHandler.END

# --- معالجة الأزرار الداخلية لأقسام البرامج ---
async def button_click(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query:
        return

    await query.answer()
    data = query.data

    if data.startswith("soft_"):
        soft_dict = {
            "soft_1": WARNING_NOTE + "🛠️ **أولًا: المكتبة المختصرة والتعريفات**\n\n" 
                      "• [Discord](https://discord.com/api/download?platform=win)\n" 
                      "• [SDIO Lite](https://www.snappy-driver-installer.org/)\n" 
                      "• [HWiNFO](https://www.hwinfo.com/download/)\n" 
                      "• [NVIDIA App](https://www.nvidia.com/en-us/software/nvidia-app/)\n" 
                      "• [AMD Auto-Detect & Install](https://www.amd.com/en/support/download/drivers.html)\n" 
                      "• [Intel Driver & Support Assistant](https://www.intel.com/content/www/us/en/support/detect.html)\n" 
                      "• [Realtek Audio](https://www.realtek.com/Download/List?cate_id=593)\n" 
                      "• [Intel Ethernet](https://www.intel.com/content/www/us/en/download-center/home.html)\n" 
                      "• [Intel Wireless](https://www.intel.com/content/www/us/en/download-center/home.html)\n" 
                      "• [AMD Chipset](https://www.amd.com/en/support/download/drivers.html)\n" 
                      "• [Intel Chipset](https://www.intel.com/content/www/us/en/download-center/home.html)",
            
            "soft_2": WARNING_NOTE + "📦 **ثانيًا: حزم التشغيل وأدوات الضغط**\n\n" 
                      "• [DirectX](https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe)\n" 
                      "• [Visual C++](https://aka.ms/vc14/vc_redist.x64.exe)\n" 
                      "• [.NET Framework](https://dotnet.microsoft.com/en-us/download/dotnet-framework/net481)\n" 
                      "• [Java](https://javadl.oracle.com/webapps/download/AutoDL?BundleId=253608_2fde65a2208f40a5b5f4c844b0dff092)\n" 
                      "• [WinRAR](https://www.win-rar.com/download.html)\n" 
                      "• [7-Zip](https://www.7-zip.org/a/7z2603-x64.exe)\n" 
                      "• [IDM](https://www.internetdownloadmanager.com/download.html)\n" 
                      "• [Everything](https://www.voidtools.com/downloads/)\n" 
                      "• [Motrix](https://motrix.app/download/)",
            
            "soft_3": WARNING_NOTE + "⚙️ **ثالثًا: الميديا، الأداء والصيانة**\n\n" 
                      "• [VLC](https://www.videolan.org/vlc/download-windows.html)\n" 
                      "• [K-Lite Mega](https://www.codecguide.com/download_kl.htm)\n" 
                      "• [AIMP](https://www.aimp.ru/?do=download)\n" 
                      "• [foobar2000](https://www.foobar2000.org/download)\n" 
                      "• [Audacity](https://www.audacityteam.org/download/windows/)\n" 
                      "• [MSI Afterburner](https://www.msi.com/Landing/afterburner)\n" 
                      "• [Process Lasso](https://bitsum.com/prolasso/)\n" 
                      "• [Lossless Scaling](https://store.steampowered.com/app/993090/Lossless_Scaling/)\n" 
                      "• [CPU-Z](https://www.cpuid.com/softwares/cpu-z.html)\n" 
                      "• [GPU-Z](https://www.techpowerup.com/download/techpowerup-gpu-z/)\n" 
                      "• [Razer Cortex](https://www.razer.com/cortex)\n" 
                      "• [Revo Uninstaller](https://www.revouninstaller.com/revo-uninstaller-free-download/)\n" 
                      "• [CrystalDiskInfo](https://crystalmark.info/en/software/crystaldiskinfo/)\n" 
                      "• [CrystalDiskMark](https://crystalmark.info/en/software/crystaldiskmark/)\n" 
                      "• [Rufus](https://rufus.ie/en/)\n" 
                      "• [SDI Origin](https://www.snappy-driver-installer.org/)",
            
            "soft_4": WARNING_NOTE + "🌐 **رابعًا: المتصفحات ومنصات الألعاب**\n\n" 
                      "• [Google Chrome](https://dl.google.com/chrome/install/latest/chrome_installer.exe)\n" 
                      "• [Microsoft Edge](https://www.microsoft.com/edge/download)\n" 
                      "• [Mozilla Firefox](https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US)\n" 
                      "• [Opera](https://www.opera.com/download)\n" 
                      "• [Opera GX](https://www.opera.com/gx)\n" 
                      "• [Brave](https://laptop-updates.brave.com/latest/winx64)\n" 
                      "• [Vivaldi](https://vivaldi.com/download/)\n" 
                      "• [Tor Browser](https://www.torproject.org/download/)\n" 
                      "• [Steam](https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe)\n" 
                      "• [Epic Games](https://store.epicgames.com/en-US/download)\n" 
                      "• [Battle.net](https://download.battle.net/en-us/desktop)\n" 
                      "• [EA App](https://www.ea.com/ea-app)\n" 
                      "• [Ubisoft Connect](https://www.ubisoft.com/en-us/ubisoft-connect/download)\n" 
                      "• [Rockstar Launcher](https://socialclub.rockstargames.com/rockstar-games-launcher)\n" 
                      "• [GOG Galaxy](https://www.gog.com/galaxy)",
            
            "soft_5": WARNING_NOTE + "💬 **خامسًا: الشبكة، التواصل والتصميم**\n\n" 
                      "• [Discord](https://discord.com/download)\n" 
                      "• [Telegram](https://desktop.telegram.org/)\n" 
                      "• [AnyDesk](https://anydesk.com/en/downloads/windows)\n" 
                      "• [TeamViewer](https://www.teamviewer.com/en/download/windows/)\n" 
                      "• [Advanced IP Scanner](https://www.advanced-ip-scanner.com/download/)\n" 
                      "• [Cloudflare WARP](https://one.one.one.one/)\n" 
                      "• [Radmin VPN](https://www.radmin-vpn.com/)\n" 
                      "• [Notepad++](https://notepad-plus-plus.org/downloads/)\n" 
                      "• [Sumatra PDF](https://www.sumatrapdfreader.org/free-pdf-reader)\n" 
                      "• [ShareX](https://getsharex.com/downloads)\n" 
                      "• [OBS Studio](https://obsproject.com/download)",
            
            "soft_6": WARNING_NOTE + "🤖 **سادسًا: الذكاء الاصطناعي ومتاجر الألعاب**\n\n" 
                      "• [ChatGPT](https://chatgpt.com/)\n" 
                      "• [Claude](https://claude.ai/)\n" 
                      "• [Gemini](https://gemini.google.com/)\n" 
                      "• [Microsoft Copilot](https://copilot.microsoft.com/)\n" 
                      "• [Perplexity](https://www.perplexity.ai/)\n" 
                      "• [Midjourney](https://www.midjourney.com/)\n" 
                      "• [Adobe Photoshop](https://www.adobe.com/products/photoshop.html)\n" 
                      "• [Adobe Illustrator](https://www.adobe.com/products/illustrator.html)\n" 
                      "• [Adobe Premiere Pro](https://www.adobe.com/products/premiere.html)\n" 
                      "• [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve)\n" 
                      "• [Blender](https://www.blender.org/download/)\n" 
                      "• [Canva](https://www.canva.com/)\n" 
                      "• [Figma](https://www.figma.com/)\n" 
                      "• [CapCut](https://www.capcut.com/)\n" 
                      "• [مهووسو الحاسوب](https://pcgeeks-games.com)\n" 
                      "• [FitGirl Repacks](https://fitgirl-repacks.site)\n" 
                      "• [DODI Repacks](https://dodi-repacks.site)\n" 
                      "• [Steam Store](https://store.steampowered.com)\n" 
                      "• [Epic Games Store](https://store.epicgames.com)\n" 
                      "• [GOG](https://www.gog.com)"
        }
        text = soft_dict.get(data, "قائمة البرامج")
        back_markup = InlineKeyboardMarkup([[InlineKeyboardButton("الرئيسية", callback_data="home_text")]])
        await query.edit_message_text(text, reply_markup=back_markup, parse_mode="Markdown")
    
    elif data == "home_text":
        await query.message.delete()
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=WELCOME_TEXT,
            reply_markup=main_reply_keyboard()
        )

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("حدث خطأ أثناء معالجة التحديث: %s", context.error)

def run() -> None:
    application = Application.builder().token(BOT_TOKEN).build()

    booking_conv = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^🎮 حجز جهاز$"), booking_day_start)
        ],
        states={
            CHOOSING_HOUR: [
                CallbackQueryHandler(booking_hour_handler, pattern="^(day_\\d{4}-\\d{2}-\\d{2}|cancel_booking|back_to_days)$")
            ],
            CHOOSING_DAY: [
                CallbackQueryHandler(booking_finish_handler, pattern="^(hour_12pm|hour_2pm|hour_4pm|hour_6pm|hour_8pm|hour_10pm|back_to_days)$")
            ],
        },
        fallbacks=[
            CommandHandler("start", start)
        ],
    )

    contact_conv = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^💬 التواصل مع الإدارة$"), contact_prompt)
        ],
        states={
            WAITING_FOR_CONTACT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_contact_message)
            ],
        },
        fallbacks=[
            CommandHandler("start", start)
        ],
    )

    application.add_handler(CommandHandler("start", start))
    application.add_handler(booking_conv)
    application.add_handler(contact_conv)
    
    # معالجة رد الأدمن المباشر عبر ميزة Reply
    application.add_handler(MessageHandler(filters.Chat(ADMIN_ID) & filters.TEXT & ~filters.COMMAND & filters.REPLY, admin_direct_reply))
    
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_reply_keyboard))
    application.add_handler(CallbackQueryHandler(button_click))
    application.add_error_handler(error_handler)

    logger.info("Telegram bot is running with Reply Keyboard menu")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    run()
