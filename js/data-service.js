/* ============================================
   BOOYAHX — CENTRALIZED DATA SERVICE
   Real Backend API Integration.
   Single source of truth for all frontend data.
   Never uses localStorage as data storage.
   BACKEND: same-origin /api
   ============================================ */

const DataService = (() => {
  'use strict';

  const API_URL = '/api';

  // ---------- core fetch wrapper ----------
  async function apiCall(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    const config = {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    };
    if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

    let response;
    try {
      response = await fetch(url, config);
    } catch (_) {
      throw new Error('BACKEND UNAVAILABLE');
    }

    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }

    if (!response.ok) {
      if (response.status === 401) throw new Error((data && data.error) || 'ACCESS DENIED');
      if (response.status === 403) throw new Error((data && data.error) || 'ACCESS DENIED');
      if (response.status === 404) throw new Error((data && data.error) || 'NOT FOUND');
      if (response.status === 503 && data && data.code === 'MAINTENANCE') throw new Error(data.error);
      throw new Error((data && data.error) || `API error: ${response.status}`);
    }
    return data;
  }

  const get = (ep, params) => {
    if (params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
      const s = qs.toString();
      if (s) ep += (ep.includes('?') ? '&' : '?') + s;
    }
    return apiCall(ep);
  };
  const post = (ep, body) => apiCall(ep, { method: 'POST', body: body || {} });
  const put = (ep, body) => apiCall(ep, { method: 'PUT', body: body || {} });
  const del = (ep) => apiCall(ep, { method: 'DELETE' });

  // ---------- AUTH ----------
  const Auth = {
    signup: data => post('/auth/signup', data),
    signin: creds => post('/auth/signin', creds),
    signout: () => post('/auth/signout'),
    me: () => get('/auth/me'),
    forgotPassword: email => post('/auth/forgot-password', { email }),
    resetPassword: (token, password, confirmPassword) => post('/auth/reset-password', { token, password, confirmPassword }),
    changePassword: (currentPassword, newPassword, confirmPassword) => post('/auth/change-password', { currentPassword, newPassword, confirmPassword }),
    loginHistory: () => get('/auth/login-history'),
    securityAlerts: () => get('/auth/security-alerts')
  };

  // ---------- TOURNAMENTS ----------
  const Tournaments = {
    getAll: params => get('/tournaments', params),
    getById: id => get(`/tournaments/${encodeURIComponent(id)}`),
    create: data => post('/tournaments', data),
    update: (id, data) => put(`/tournaments/${encodeURIComponent(id)}`, data),
    remove: (id, purge) => del(`/tournaments/${encodeURIComponent(id)}${purge ? '?purge=1' : ''}`),
    join: id => post(`/tournaments/${encodeURIComponent(id)}/join`),
    leave: id => post(`/tournaments/${encodeURIComponent(id)}/leave`),
    myRegistrations: () => get('/tournaments/me/registrations'),
    getBracket: id => get(`/tournaments/${encodeURIComponent(id)}/bracket`),
    saveBracket: (id, matches) => put(`/tournaments/${encodeURIComponent(id)}/bracket`, { matches })
  };

  // ---------- TEMPLATES / CATEGORIES / TAGS / SERIES ----------
  const Templates = {
    getAll: () => get('/tournament-templates'),
    create: data => post('/tournament-templates', data),
    update: (id, data) => put(`/tournament-templates/${encodeURIComponent(id)}`, data),
    remove: id => del(`/tournament-templates/${encodeURIComponent(id)}`),
    duplicate: id => post(`/tournament-templates/${encodeURIComponent(id)}/duplicate`),
    createTournament: (id, data) => post(`/tournament-templates/${encodeURIComponent(id)}/create-tournament`, data)
  };

  const Taxonomy = {
    categories: () => get('/categories'),
    createCategory: data => post('/categories', data),
    deleteCategory: id => del(`/categories/${encodeURIComponent(id)}`),
    tags: () => get('/tags'),
    createTag: data => post('/tags', data),
    deleteTag: id => del(`/tags/${encodeURIComponent(id)}`)
  };

  const Series = {
    getAll: () => get('/series'),
    create: data => post('/series', data),
    update: (id, data) => put(`/series/${encodeURIComponent(id)}`, data),
    remove: id => del(`/series/${encodeURIComponent(id)}`),
    standings: id => get(`/series/${encodeURIComponent(id)}/standings`)
  };

  // ---------- WALLET / ECONOMY ----------
  const Wallet = {
    get: () => get('/wallet'),
    transactions: params => get('/wallet/transactions', params),
    packages: () => get('/coin-packages'),
    createPackage: data => post('/coin-packages', data),
    updatePackage: (id, data) => put(`/coin-packages/${encodeURIComponent(id)}`, data),
    deletePackage: id => del(`/coin-packages/${encodeURIComponent(id)}`)
  };

  const Payments = {
    methods: () => get('/payment-methods')
  };

  const OAuth = {
    status: () => get('/auth/oauth/status')
  };

  // ---------- MEMBERS ----------
  const Members = {
    all: () => get('/users'),
    search: q => get('/users/search', { q }),
    getById: id => get(`/users/${encodeURIComponent(id)}`),
    getProfile: id => get(`/users/${encodeURIComponent(id)}/profile`)
  };

  // Moderator dashboard (scoped moderator.* permissions; server-enforced)
  const Moderator = {
    overview: () => get('/moderator/overview'),
    tournaments: () => get('/moderator/tournaments'),
    registrations: id => get(`/tournaments/${encodeURIComponent(id)}/registrations`),
    eventItems: eventId => get(`/moderator/events/${encodeURIComponent(eventId)}/items`),
    createEventItem: (eventId, data) => post(`/moderator/events/${encodeURIComponent(eventId)}/items`, data),
    updateEventItem: (id, data) => put(`/moderator/event-items/${encodeURIComponent(id)}`, data),
    deleteEventItem: id => del(`/moderator/event-items/${encodeURIComponent(id)}`),
    searchUsers: q => get('/moderator/coins/users', { q }),
    userHistory: id => get(`/moderator/coins/users/${encodeURIComponent(id)}/history`),
    adjustCoins: data => post('/moderator/coins/adjust', data),
    money: () => get('/moderator/money')
  };

  const Console = {
    get: () => get('/console'),
    switchTo: mode => post('/console/switch', { console: mode })
  };

  const Deposits = {
    create: data => post('/deposits', data),
    mine: () => get('/deposits/me'),
    all: params => get('/deposits', params),
    approve: (id, notes) => post(`/deposits/${encodeURIComponent(id)}/approve`, { notes }),
    reject: (id, notes) => post(`/deposits/${encodeURIComponent(id)}/reject`, { notes })
  };

  const Withdrawals = {
    create: data => post('/withdrawals', data),
    mine: () => get('/withdrawals/me'),
    all: params => get('/withdrawals', params),
    approve: (id, data) => post(`/withdrawals/${encodeURIComponent(id)}/approve`, data || {}),
    reject: (id, notes) => post(`/withdrawals/${encodeURIComponent(id)}/reject`, { notes })
  };

  const Promos = {
    all: () => get('/promo-codes'),
    create: data => post('/promo-codes', data),
    remove: id => del(`/promo-codes/${encodeURIComponent(id)}`),
    redeem: code => post('/promo-codes/redeem', { code })
  };

  const DailyReward = {
    get: () => get('/daily-reward'),
    claim: () => post('/daily-reward/claim')
  };

  const Vip = {
    tiers: () => get('/vip/tiers'),
    mine: () => get('/vip/me'),
    createTier: data => post('/vip/tiers', data),
    updateTier: (id, data) => put(`/vip/tiers/${encodeURIComponent(id)}`, data),
    grant: data => post('/vip/grant', data),
    revoke: id => del(`/vip/grant/${encodeURIComponent(id)}`)
  };

  const Referrals = {
    mine: () => get('/referrals/me'),
    apply: code => post('/referrals/apply', { code })
  };

  // ---------- RESULTS / LEADERBOARD / STATS ----------
  const Results = {
    all: params => get('/tournament-results', params),
    save: data => post('/tournament-results', data),
    publish: (tournamentId, force) => post(`/tournament-results/${encodeURIComponent(tournamentId)}/publish${force ? '?force=1' : ''}`)
  };

  const Leaderboard = {
    get: params => get('/leaderboard', params)
  };

  const Players = {
    stats: username => get(`/players/${encodeURIComponent(username)}/stats`)
  };

  const Achievements = {
    all: () => get('/achievements'),
    create: data => post('/achievements', data),
    update: (id, data) => put(`/achievements/${encodeURIComponent(id)}`, data),
    remove: id => del(`/achievements/${encodeURIComponent(id)}`)
  };

  // ---------- TEAMS ----------
  const Teams = {
    all: () => get('/teams'),
    get: id => get(`/teams/${encodeURIComponent(id)}`),
    create: data => post('/teams', data),
    update: (id, data) => put(`/teams/${encodeURIComponent(id)}`, data),
    remove: id => del(`/teams/${encodeURIComponent(id)}`),
    invite: (id, username) => post(`/teams/${encodeURIComponent(id)}/invites`, { username }),
    respondInvite: (inviteId, action) => post(`/teams/invites/${encodeURIComponent(inviteId)}/respond`, { action }),
    removeMember: (id, userId) => del(`/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`)
  };

  // ---------- CONTENT ----------
  const Content = {
    events: params => get('/events', { ...params, include_drafts: params && params.drafts ? '1' : '' }),
    eventStore: (eventId) => get('/events/' + encodeURIComponent(eventId) + '/items'),
    buyEventItem: (eventId, itemId) => post('/events/' + encodeURIComponent(eventId) + '/items/' + encodeURIComponent(itemId) + '/purchase'),
    news: params => get('/news', params),
    updates: params => get('/updates', params),
    banners: () => get('/banners'),
    activeBanners: () => get('/banners/active'),
    popups: () => get('/popups'),
    activePopups: () => get('/popups/active'),
    sponsors: () => get('/sponsors'),
    activeSponsors: () => get('/sponsors/active'),
    highlights: () => get('/highlights'),
    activeHighlights: () => get('/highlights/active'),
    polls: includeDrafts => get('/polls', includeDrafts ? { include_drafts: '1' } : null),
    createPoll: data => post('/polls', data),
    updatePoll: (id, data) => put(`/polls/${encodeURIComponent(id)}`, data),
    removePoll: id => del(`/polls/${encodeURIComponent(id)}`),
    vote: (pollId, optionId) => post(`/polls/${encodeURIComponent(pollId)}/vote`, { option_id: optionId }),
    home: () => get('/site/home')
  };

  // Generic content CRUD helpers for owner pages.
  // list() always asks for drafts/inactive rows — the server only honors
  // include_drafts when the session actually has permission for that table.
  function contentCrud(table) {
    return {
      list: params => get(`/${table}`, { include_drafts: '1', ...params }),
      create: data => post(`/${table}`, data),
      update: (id, data) => put(`/${table}/${encodeURIComponent(id)}`, data),
      remove: id => del(`/${table}/${encodeURIComponent(id)}`)
    };
  }

  // ---------- SUPPORT / MODERATION ----------
  const Support = {
    createTicket: data => post('/support/tickets', data),
    tickets: params => get('/support/tickets', params),
    ticket: id => get(`/support/tickets/${encodeURIComponent(id)}`),
    reply: (id, message, internal) => post(`/support/tickets/${encodeURIComponent(id)}/messages`, { message, internal }),
    close: id => post(`/support/tickets/${encodeURIComponent(id)}/close`),
    reopen: id => post(`/support/tickets/${encodeURIComponent(id)}/reopen`),
    assign: (id, assignee_id) => post(`/support/tickets/${encodeURIComponent(id)}/assign`, { assignee_id }),
    submitFeedback: data => post('/feedback', data),
    myFeedback: () => get('/feedback/me'),
    allFeedback: params => get('/feedback', params),
    respondFeedback: (id, data) => post(`/feedback/${encodeURIComponent(id)}/respond`, data),
    submitReport: data => post('/reports', data),
    reports: params => get('/reports', params),
    handleReport: (id, data) => post(`/reports/${encodeURIComponent(id)}/handle`, data)
  };

  const Notifications = {
    mine: () => get('/notifications'),
    markRead: id => post(`/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => post('/notifications/read-all'),
    broadcast: data => post('/notifications/broadcast', data)
  };

  // ---------- OWNER / ADMIN ----------
  const Owner = {
    stats: () => get('/owner/stats'),
    activity: () => get('/owner/activity'),
    users: params => get('/owner/users', params),
    updateUser: (id, data) => put(`/owner/users/${encodeURIComponent(id)}`, data),
    deleteUser: id => del(`/owner/users/${encodeURIComponent(id)}`),
    bulkUsers: data => post('/owner/users/bulk', data),
    auditLogs: params => get('/owner/audit-logs', params),
    team: () => get('/owner/team'),
    officialTeam: () => get('/owner/official-team'),
    assignOfficialTeam: data => post('/owner/official-team/assign', data),
    revokeOfficialTeam: data => post('/owner/official-team/revoke', data),
    setOfficialTeamActive: data => post('/owner/official-team/set-active', data),
    assignRole: data => post('/owner/team/assign', data),
    revokeRole: data => post('/owner/team/revoke', data),
    disableStaff: data => post('/owner/team/disable', data),
    roles: () => get('/roles'),
    roleDetail: name => get(`/roles/${encodeURIComponent(name)}/permissions`),
    verifications: params => get('/owner/verifications', params),
    reviewVerification: (id, data) => post(`/owner/verifications/${encodeURIComponent(id)}/review`, data),
    emailTemplates: () => get('/owner/email/templates'),
    updateEmailTemplate: (id, data) => put(`/owner/email/templates/${encodeURIComponent(id)}`, data),
    apiKeys: () => get('/owner/api-keys'),
    createApiKey: data => post('/owner/api-keys', data),
    revokeApiKey: id => del(`/owner/api-keys/${encodeURIComponent(id)}`),
    backups: () => get('/owner/backups'),
    createBackup: () => post('/owner/backups'),
    restoreBackup: (id, confirm) => post(`/owner/backups/${encodeURIComponent(id)}/restore`, { confirm }),
    exportEntities: () => get('/owner/export-entities'),
    exportUrl: (entity, format) => `${API_URL}/owner/export/${encodeURIComponent(entity)}?format=${format}`,
    importData: (entity, data) => post(`/owner/import/${encodeURIComponent(entity)}`, data),
    analytics: () => get('/owner/analytics'),
    systemHealth: () => get('/owner/system-health'),
    errors: () => get('/owner/errors'),
    resolveError: id => post(`/owner/owner/errors/${encodeURIComponent(id)}/resolve`.replace('/owner/owner/', '/owner/')),
    maintenance: () => get('/owner/maintenance'),
    setMaintenance: data => post('/owner/maintenance', data),
    securityAlerts: () => get('/owner/security-alerts'),
    resolveSecurityAlert: id => post(`/owner/security-alerts/${encodeURIComponent(id)}/resolve`),
    loginHistory: userId => get(`/owner/login-history/${encodeURIComponent(userId)}`)
  };

  // ---------- PUBLIC OFFICIAL TEAM (BooyahX operating team, not player clans) ----------
  const OfficialTeam = {
    get: () => get('/official-team')
  };

  // ---------- SETTINGS / SYSTEM ----------
  const Settings = {
    get: () => get('/settings'),
    update: data => put('/settings', data)
  };

  const System = {
    health: () => get('/health'),
    maintenance: () => get('/system/maintenance'),
    reportError: data => post('/errors', data)
  };

  const Verification = {
    mine: () => get('/verification/me'),
    submit: data => post('/verification', data)
  };

  return {
    API_URL, apiCall, get, post, put, del,
    Auth, Tournaments, Templates, Taxonomy, Series,
    Wallet, Payments, Console, Deposits, Withdrawals, Promos, DailyReward, Vip, Referrals,
    Results, Leaderboard, Players, Achievements, Teams,
    Content, contentCrud, Support, Notifications,
    Owner, OfficialTeam, Moderator, OAuth, Settings, System, Verification
  };
})();

// Back-compat: older pages reference BooyahApi
if (typeof window !== 'undefined') window.BooyahApi = DataService;
