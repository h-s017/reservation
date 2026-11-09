// Privacy-minimal, best-effort anonymous event tracking for course reservation funnel.
// Public Supabase publishable key; database RLS permits only event inserts for anonymous visitors.
(() => {
  'use strict';
  const endpoint = 'https://uzqaodfmnrjrsbvxhlmh.supabase.co/rest/v1/analytics_events';
  const key = 'sb_publishable_3ukkjs-QtgauXjmOrcDAVg_XBWzh2rd';
  const allowed = new Set(['view','reservation_series_select','reservation_course_select','reservation_order_created','reservation_paid']);
  const source = (() => {
    try {
      const params = new URLSearchParams(location.search);
      const utm = (params.get('utm_source') || '').toLowerCase();
      if (utm.includes('instagram') || utm === 'ig') return 'Instagram';
      if (utm.includes('line')) return 'LINE';
      if (utm.includes('google')) return 'Google';
      const ref = new URL(document.referrer);
      if (/instagram\.com/i.test(ref.hostname)) return 'Instagram';
      if (/line\.me|line-apps\.com/i.test(ref.hostname)) return 'LINE';
      if (/google\./i.test(ref.hostname)) return 'Google';
      return ref.hostname ? 'Other' : 'Direct';
    } catch (_) { return 'Direct'; }
  })();
  // Ephemeral, random per-tab session ID: counts approximate visits without collecting identity.
  const visitorSession = (() => {
    const storageKey = 'hana-reservation-visitor-session-v1';
    try {
      let id = sessionStorage.getItem(storageKey);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(storageKey, id);
      }
      return id;
    } catch (_) {
      return crypto.randomUUID();
    }
  })();
  function record(eventType) {
    if (!allowed.has(eventType)) return;
    const payload = {
      page: 'reservation',
      event_type: eventType,
      session_id: visitorSession,
      source,
      path: 'reservation.hanascent.com/',
      metadata: {}
    };
    fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      keepalive: true,
      headers: {'apikey': key,'Content-Type':'application/json','Prefer':'return=minimal'},
      body: JSON.stringify(payload)
    }).then(response => { if (!response.ok) console.warn('[HANA analytics] Event not saved:', response.status); }).catch(error => { console.warn('[HANA analytics] Connection failed:', error?.message || 'network error'); });
  }
  const once = (type, id) => {
    if (!id) return;
    const k = 'hana-analytics-' + type + '-' + id;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (_) {}
    record(type);
  };
  window.HanaReservationAnalytics = Object.freeze({record,once});
  record('view');
})();
