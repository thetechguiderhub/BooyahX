/* ============================================
   BOOYAHX — INTERNATIONALIZATION
   English | اردو
   Translation keys only — no business data.
   Language preference: localStorage for guests,
   profile preferences (server) when signed in.
   ============================================ */

const I18n = (() => {
  'use strict';

  const STORAGE_KEY = 'bx_locale';

  const DICT = {
    en: {
      // Navbar
      'nav.home': 'Home',
      'nav.tournaments': 'Tournaments',
      'nav.leaderboard': 'Leaderboard',
      'nav.events': 'Events',
      'nav.news': 'News',
      'nav.updates': 'Updates',
      'nav.support': 'Support',
      'nav.wallet': 'Wallet',
      'nav.profile': 'Profile',
      'nav.signin': 'Sign In',
      'nav.signup': 'Sign Up',
      'nav.signout': 'Sign Out',
      'nav.achievements': 'Achievements',
      'nav.teams': 'Teams',
      'nav.members': 'Members',
      'nav.about': 'About',
      'nav.rules': 'Rules',
      'nav.settings': 'Settings',
      'nav.notifications': 'Notifications',
      'nav.my_tournaments': 'My Tournaments',

      // Buttons
      'btn.join': 'Join Now',
      'btn.leave': 'Leave',
      'btn.register': 'Register',
      'btn.submit': 'Submit',
      'btn.cancel': 'Cancel',
      'btn.save': 'Save',
      'btn.delete': 'Delete',
      'btn.edit': 'Edit',
      'btn.close': 'Close',
      'btn.confirm': 'Confirm',
      'btn.retry': 'Retry',
      'btn.claim': 'Claim',
      'btn.view_details': 'View Details',
      'btn.create': 'Create',
      'btn.approve': 'Approve',
      'btn.reject': 'Reject',
      'btn.search': 'Search',
      'btn.refresh': 'Refresh',

      // Tournament statuses
      'status.upcoming': 'UPCOMING',
      'status.waiting': 'WAITING',
      'status.almost_full': 'ALMOST FULL',
      'status.full': 'FULL',
      'status.starting': 'STARTING',
      'status.live': 'LIVE',
      'status.results_pending': 'RESULTS PENDING',
      'status.completed': 'COMPLETED',
      'status.cancelled': 'CANCELLED',

      // Wallet
      'wallet.balance': 'Balance',
      'wallet.coins': 'BX Coins',
      'wallet.transactions': 'Transactions',
      'wallet.deposit': 'Deposit',
      'wallet.withdraw': 'Withdraw',
      'wallet.deposits': 'Deposits',
      'wallet.withdrawals': 'Withdrawals',
      'wallet.entry_fee': 'Entry Fee',
      'wallet.rewards': 'Rewards',
      'wallet.daily_reward': 'Daily Reward',
      'wallet.no_transactions': 'NO TRANSACTIONS YET',

      // Leaderboard
      'lb.rank': 'Rank',
      'lb.player': 'Player',
      'lb.wins': 'Wins',
      'lb.matches': 'Matches',
      'lb.tournaments': 'Tournaments',
      'lb.coins_earned': 'BX Coins Earned',
      'lb.win_rate': 'Win Rate',
      'lb.score': 'Score',
      'lb.global': 'Global',
      'lb.cs': 'Clash Squad',
      'lb.br': 'Battle Royale',
      'lb.weekly': 'Weekly',
      'lb.monthly': 'Monthly',
      'lb.all_time': 'All Time',
      'lb.empty': 'NO LEADERBOARD DATA AVAILABLE',

      // Auth
      'auth.email': 'Email',
      'auth.username': 'Username',
      'auth.password': 'Password',
      'auth.confirm_password': 'Confirm Password',
      'auth.full_name': 'Full Name',
      'auth.forgot_password': 'Forgot password?',
      'auth.have_account': 'Already have an account?',
      'auth.no_account': "Don't have an account?",
      'auth.terms': 'I accept the terms and conditions',

      // Support
      'support.title': 'Support Center',
      'support.new_ticket': 'New Ticket',
      'support.my_tickets': 'My Tickets',
      'support.category': 'Category',
      'support.subject': 'Subject',
      'support.message': 'Message',
      'support.status': 'Status',
      'support.no_tickets': 'NO SUPPORT TICKETS',

      // Common errors
      'error.backend': 'BACKEND UNAVAILABLE',
      'error.access_denied': 'ACCESS DENIED',
      'error.not_found': 'NOT FOUND',
      'error.network': 'Unable to connect to the server',
      'error.required': 'Please fill in all required fields',
      'error.invalid_credentials': 'Invalid credentials',
      'error.insufficient': 'Insufficient BX Coins',
      'error.maintenance': 'BOOYAHX IS CURRENTLY UNDER MAINTENANCE',

      // Empty states
      'empty.tournaments': 'NO TOURNAMENTS AVAILABLE',
      'empty.tournaments_sub': 'There are currently no tournaments available. Check back soon for new competitions.',
      'empty.events': 'NO EVENTS AVAILABLE',
      'empty.events_sub': 'There are currently no active or upcoming events. Check back soon for new competitions.',
      'empty.upcoming': 'NO UPCOMING TOURNAMENTS',
      'empty.upcoming_sub': 'There are currently no upcoming tournaments. Check back soon for new competitions.',
      'nav.create_account': 'Create Account',
      'empty.news': 'NO NEWS AVAILABLE',
      'empty.news_sub': 'There are currently no news articles. Check back soon for updates.',
      'empty.updates_sub': 'There are currently no published updates. Check back soon for new features and improvements.',
      'empty.filter_sub': 'No items match the current filter or search.',
      'empty.updates': 'NO UPDATES AVAILABLE',
      'empty.results': 'NO RESULTS AVAILABLE',
      'empty.deposits': 'NO DEPOSIT REQUESTS',
      'empty.withdrawals': 'NO WITHDRAWAL REQUESTS',
      'empty.users': 'NO USERS FOUND',
      'empty.notifications': 'NO NOTIFICATIONS',
      'empty.achievements': 'NO ACHIEVEMENTS UNLOCKED',
      'empty.achievements_available': 'NO ACHIEVEMENTS AVAILABLE',
      'empty.achievements_sub': 'Achievement definitions appear here once configured.',
      'empty.teams': 'NO TEAMS AVAILABLE',
      'empty.teams_sub': 'Teams appear here once players create them.',
      'empty.members': 'NO MEMBERS FOUND',
      'empty.members_sub': 'Registered members will appear here.',
      'empty.reports': 'NO REPORTS',
      'empty.search': 'NO RESULTS FOUND',

      // Dynamic renderers (cards, tables, errors)
      'btn.join_tournament': 'JOIN TOURNAMENT',
      'btn.view_results': 'VIEW RESULTS',
      'card.entry': 'Entry',
      'card.starts': 'Starts',
      'card.players': 'Players',
      'lb.empty_sub': 'Rankings appear once tournament results are published.',
      'lb.error': 'COULD NOT LOAD LEADERBOARD',
      'achievements.error': 'COULD NOT LOAD ACHIEVEMENTS',
      'ach.unlocked': 'UNLOCKED',
      'ach.locked': 'LOCKED',
      'error.unable_load': 'UNABLE TO LOAD DATA',
      'error.retry_sub': 'The server could not be reached. Please try again.',
      'status.active': 'ACTIVE',
      'event.reward': 'Reward',
      'news.read_more': 'Read more',
      'update.new': 'New',
      'update.improvements': 'Improvements',
      'update.fixes': 'Fixes',
      'highlights.title': 'HIGHLIGHTS',
      'tab.active': 'Active',
      'tab.upcoming': 'Upcoming',
      'tab.completed': 'Completed',

      // Event store (items + purchases)
      'unit.coins': 'BX Coins',
      'store.open': 'STORE',
      'store.title': 'Event Store',
      'store.price': 'Price',
      'store.buy': 'BUY WITH BX COINS',
      'store.owned': 'OWNED',
      'store.sold_out': 'SOLD OUT',
      'store.empty': 'No items available yet.',
      'store.mine': 'My Purchases',
      'store.signin': 'Sign in to buy items.',

      // Community / official social links
      'community.title': 'COMMUNITY',
      'community.sub': 'Follow BooyahX for official updates, announcements and new content.',
      'community.whatsapp_btn': 'WhatsApp Channel',
      'community.youtube_btn': 'YouTube',
      'community.whatsapp_desc': 'Official announcements, updates, tournament news and events.',
      'community.youtube_desc': 'Official videos, tutorials and platform updates.'
    },

    ur: {
      // Navbar
      'nav.home': 'ہوم',
      'nav.tournaments': 'ٹورنامنٹس',
      'nav.leaderboard': 'لیڈر بورڈ',
      'nav.events': 'ایونٹس',
      'nav.news': 'خبریں',
      'nav.updates': 'اپڈیٹس',
      'nav.support': 'سپورٹ',
      'nav.wallet': 'والٹ',
      'nav.profile': 'پروفائل',
      'nav.signin': 'سائن ان',
      'nav.signup': 'سائن اپ',
      'nav.signout': 'سائن آؤٹ',
      'nav.achievements': 'کامیابیاں',
      'nav.teams': 'ٹیمیں',
      'nav.about': 'تعارف',
      'nav.rules': 'قواعد',
      'nav.settings': 'ترتیبات',
      'nav.notifications': 'اطلاعات',
      'nav.my_tournaments': 'میرے ٹورنامنٹس',

      // Buttons
      'btn.join': 'شمولیت کریں',
      'btn.leave': 'چھوڑیں',
      'btn.register': 'رجسٹر کریں',
      'btn.submit': 'جمع کریں',
      'btn.cancel': 'منسوخ',
      'btn.save': 'محفوظ کریں',
      'btn.delete': 'حذف کریں',
      'btn.edit': 'ترمیم',
      'btn.close': 'بند کریں',
      'btn.confirm': 'تصدیق کریں',
      'btn.retry': 'دوبارہ کوشش',
      'btn.claim': 'وصول کریں',
      'btn.view_details': 'تفصیلات دیکھیں',
      'btn.create': 'بنائیں',
      'btn.approve': 'منظور کریں',
      'btn.reject': 'مسترد کریں',
      'btn.search': 'تلاش',
      'btn.refresh': 'ریفریش',

      // Tournament statuses
      'status.upcoming': 'آنے والا',
      'status.waiting': 'انتظار',
      'status.almost_full': 'تقریباً بھرا ہوا',
      'status.full': 'مکمل',
      'status.starting': 'شروع ہو رہا',
      'status.live': 'لائیو',
      'status.results_pending': 'نتائج زیرِ التواء',
      'status.completed': 'مکمل',
      'status.cancelled': 'منسوخ',

      // Wallet
      'wallet.balance': 'بیلنس',
      'wallet.coins': 'BX کوینز',
      'wallet.transactions': 'لین دین',
      'wallet.deposit': 'ڈپازٹ',
      'wallet.withdraw': 'نکالیں',
      'wallet.deposits': 'ڈپازٹس',
      'wallet.withdrawals': 'وڈرالز',
      'wallet.entry_fee': 'انٹری فیس',
      'wallet.rewards': 'انعامات',
      'wallet.daily_reward': 'روزانہ انعام',
      'wallet.no_transactions': 'ابھی کوئی لین دین نہیں',

      // Leaderboard
      'lb.rank': 'درجہ',
      'lb.player': 'کھلاڑی',
      'lb.wins': 'جیت',
      'lb.matches': 'میچز',
      'lb.tournaments': 'ٹورنامنٹس',
      'lb.coins_earned': 'کمائے گئے BX کوینز',
      'lb.win_rate': 'جیت کی شرح',
      'lb.score': 'اسکور',
      'lb.global': 'عالمی',
      'lb.cs': 'کلیش اسکوڈ',
      'lb.br': 'بیٹل روائل',
      'lb.weekly': 'ہفتہ وار',
      'lb.monthly': 'ماہانہ',
      'lb.all_time': 'تمام وقت',
      'lb.empty': 'لیڈر بورڈ کا کوئی ڈیٹا دستیاب نہیں',

      // Auth
      'auth.email': 'ای میل',
      'auth.username': 'صارف نام',
      'auth.password': 'پاس ورڈ',
      'auth.confirm_password': 'پاس ورڈ کی تصدیق',
      'auth.full_name': 'پورا نام',
      'auth.forgot_password': 'پاس ورڈ بھول گئے؟',
      'auth.have_account': 'پہلے سے اکاؤنٹ ہے؟',
      'auth.no_account': 'اکاؤنٹ نہیں ہے؟',
      'auth.terms': 'میں شرائط و ضوابط قبول کرتا ہوں',

      // Support
      'support.title': 'سپورٹ مرکز',
      'support.new_ticket': 'نیا ٹکٹ',
      'support.my_tickets': 'میرے ٹکٹس',
      'support.category': 'زمرہ',
      'support.subject': 'موضوع',
      'support.message': 'پیغام',
      'support.status': 'حیثیت',
      'support.no_tickets': 'کوئی سپورٹ ٹکٹ نہیں',

      // Common errors
      'error.backend': 'بیک اینڈ دستیاب نہیں',
      'error.access_denied': 'رسائی مسترد',
      'error.not_found': 'نہیں ملا',
      'error.network': 'سرور سے رابطہ نہیں ہو سکا',
      'error.required': 'تمام ضروری خانے بھریں',
      'error.invalid_credentials': 'غلط اسناد',
      'error.insufficient': 'ناکافی BX کوینز',
      'error.maintenance': 'BOOYAHX فی الحال مرمت کے تحت ہے',

      // Empty states
      'empty.tournaments': 'کوئی ٹورنامنٹ دستیاب نہیں',
      'empty.tournaments_sub': 'اس وقت کوئی ٹورنامنٹ دستیاب نہیں۔ نئے مقابلات کے لیے دوبارہ چیک کریں۔',
      'empty.events': 'کوئی ایونٹ دستیاب نہیں',
      'empty.events_sub': 'اس وقت کوئی فعال یا آنے والا ایونٹ نہیں۔ نئے مقابلات کے لیے دوبارہ چیک کریں۔',
      'empty.upcoming': 'کوئی آنے والا ٹورنامنٹ نہیں',
      'empty.upcoming_sub': 'اس وقت کوئی آنے والا ٹورنامنٹ نہیں۔ نئے مقابلات کے لیے دوبارہ چیک کریں۔',
      'nav.create_account': 'اکاؤنٹ بنائیں',
      'empty.news': 'کوئی خبر دستیاب نہیں',
      'empty.updates': 'کوئی اپڈیٹ دستیاب نہیں',
      'empty.results': 'کوئے نتائج دستیاب نہیں',
      'empty.deposits': 'کوئی ڈپازٹ درخواست نہیں',
      'empty.withdrawals': 'کوئی رقم نکالنے کی درخواست نہیں',
      'empty.users': 'کوئی صارف نہیں ملا',
      'empty.notifications': 'کوئی اطلاع نہیں',
      'empty.achievements': 'کوئی کامیابی حاصل نہیں کی گئی',
      'empty.achievements_available': 'کوئی کامیابی دستیاب نہیں',
      'empty.achievements_sub': 'تفصیلات ترتیب دینے کے بعد یہاں نظر آئیں گی۔',
      'empty.teams': 'کوئی ٹیم دستیاب نہیں',
      'empty.teams_sub': 'صارفین کے ٹیم بنانے کے بعد یہاں نظر آئیں گی۔',
      'empty.reports': 'کوئی رپورٹ نہیں',
      'empty.search': 'کوئی نتیجہ نہیں ملا',

      // Dynamic renderers (cards, tables, errors)
      'btn.join_tournament': 'ٹورنامنٹ میں شامل ہوں',
      'btn.view_results': 'نتائج دیکھیں',
      'card.entry': 'انٹری',
      'card.starts': 'شروع',
      'card.players': 'کھلاڑی',
      'lb.empty_sub': 'نتائج شائع ہونے کے بعد رینکنگ نظر آئے گی۔',
      'lb.error': 'لیڈر بورڈ لوڈ نہیں ہو سکا',
      'achievements.error': 'کامیابیاں لوڈ نہیں ہو سکیں',
      'ach.unlocked': 'حاصل شدہ',
      'ach.locked': 'بند',
      'error.unable_load': 'ڈیٹا لوڈ نہیں ہو سکا',
      'error.retry_sub': 'سرور سے رابطہ نہیں ہو سکا۔ براہ کرم دوبارہ کوشش کریں۔',
      'empty.news_sub': 'اس وقت کوئی خبر دستیاب نہیں۔ اپڈیٹس کے لیے دوبارہ چیک کریں۔',
      'empty.updates_sub': 'اس وقت کوئی شائع شدہ اپڈیٹ دستیاب نہیں۔ نئی خصوصیات کے لیے دوبارہ چیک کریں۔',
      'empty.filter_sub': ' موجودہ فلٹر یا سرچ سے کوئی چیز میچ نہیں کرتی۔',
      'status.active': 'فعال',
      'event.reward': 'انعام',
      'news.read_more': 'مزید پڑھیں',
      'update.new': 'نیا',
      'update.improvements': 'بہتریاں',
      'update.fixes': 'درستیاں',
      'highlights.title': 'نمایاں مناظر',
      'tab.active': 'فعال',
      'tab.upcoming': 'آنے والا',
      'tab.completed': 'مکمل',

      // Event store (items + purchases)
      'unit.coins': 'BX کوینز',
      'store.open': 'اسٹور',
      'store.title': 'ایونٹ اسٹور',
      'store.price': 'قیمت',
      'store.buy': 'BX کوینز خریدیں',
      'store.owned': 'خرید لیا',
      'store.sold_out': 'ختم',
      'store.empty': 'ابھی کوئی آئٹم دستیاب نہیں۔',
      'store.mine': 'میری خریداری',
      'store.signin': 'خریداری کے لیے سائن ان کریں۔',

      // Community / official social links
      'community.title': 'کمیونٹی',
      'community.sub': 'اپ ڈیٹس، اعلانات اور نئی محتواء کے لیے بویہ ایکس کو فالو کریں۔',
      'community.whatsapp_btn': 'واٹس ایپ چینل',
      'community.youtube_btn': 'یوٹیوب',
      'community.whatsapp_desc': 'سرکاری اعلانات، اپ ڈیٹس، ٹورنامنٹ نیوز اور ایونٹس۔',
      'community.youtube_desc': 'سرکاری ویڈیوز، ٹیوٹوریلز اور پلیٹ فارم اپ ڈیٹس۔'
    }
  };

  let locale = 'en';
  let serverSync = false; // true when a session exists (server preference is authoritative)

  function init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DICT[saved]) locale = saved;
      else if ((navigator.language || '').toLowerCase().startsWith('ur')) locale = 'ur';
    } catch (_) {}
    apply();

    // Signed in? The server-stored preference wins over the local guess.
    fetch('/api/auth/preferences', { credentials: 'include' })
      .then(r => {
        if (r.status === 401) return null;  // guest — localStorage stays the source
        if (!r.ok) throw new Error('preferences unavailable');
        return r.json();
      })
      .then(data => {
        if (!data) return;
        serverSync = true;
        const serverLocale = data.preferences && data.preferences.locale;
        if (serverLocale && DICT[serverLocale] && serverLocale !== locale) setLocale(serverLocale);
      })
      .catch(() => {}); // backend unavailable — keep the local preference, no false claims
  }

  function t(key) {
    const d = DICT[locale] || DICT.en;
    return d[key] !== undefined ? d[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
  }

  /** Apply translations to all [data-i18n] elements. */
  function apply() {
    document.documentElement.lang = locale === 'ur' ? 'ur' : 'en';
    document.documentElement.dir = locale === 'ur' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const d = DICT[locale] || DICT.en;
      if (d[key] === undefined && DICT.en[key] === undefined) return; // no translation — keep rendered text
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const d = DICT[locale] || DICT.en;
      if (d[key] === undefined && DICT.en[key] === undefined) return;
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    const toggle = document.getElementById('lang-toggle');
    if (toggle) toggle.textContent = locale === 'en' ? 'اردو' : 'English';
  }

  function setLocale(next) {
    if (!DICT[next]) return;
    locale = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    apply();
    // Persist for this account when signed in (server stays authoritative)
    if (serverSync) {
      fetch('/api/auth/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next })
      }).catch(() => {});
    }
  }

  function toggle() { setLocale(locale === 'en' ? 'ur' : 'en'); }

  function getLocale() { return locale; }

  return { init, t, apply, setLocale, toggle, getLocale };
})();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    I18n.init();
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.addEventListener('click', () => I18n.toggle());
  });
}
