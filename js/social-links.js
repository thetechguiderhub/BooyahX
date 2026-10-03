/* ============================================
   BOOYAHX — OFFICIAL SOCIAL / COMMUNITY LINKS
   ----------------------------------------
   Single source of truth for the official
   BooyahX community links. Only REAL, official
   links live here — never placeholders, never
   invented statistics.

   Renders:
   - icon-only links (footer social rows)
   - labeled pill buttons (community blocks)
   and auto-injects a COMMUNITY block into any
   page footer that does not already contain the
   official links.
   ============================================ */

const BooyahSocial = (() => {
  'use strict';

  // OFFICIAL LINKS ONLY (exact URLs — do not alter)
  const LINKS = [
    {
      id: 'whatsapp',
      label: 'WhatsApp Channel',
      url: 'https://whatsapp.com/channel/0029Vb9Ify09WtC892wVPa30',
      aria: 'BooyahX WhatsApp Channel — official announcements, updates, tournament news and community information',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>'
    },
    {
      id: 'youtube',
      label: 'YouTube',
      url: 'https://www.youtube.com/@thetechguider01',
      aria: 'The Tech Guider 01 — official BooyahX YouTube channel for video content, tutorials and platform updates',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>'
    }
  ];

  const attrs = l =>
    `data-official-social="${l.id}" href="${l.url}" target="_blank" rel="noopener noreferrer" title="${l.label}"`;

  // Icon-only buttons (for .footer-social rows)
  function iconLinks() {
    return LINKS.map(l =>
      `<a ${attrs(l)} aria-label="${l.aria}">${l.icon}</a>`).join('');
  }

  // Labeled pill buttons (for COMMUNITY blocks)
  function pillLinks() {
    return LINKS.map(l =>
      `<a class="social-pill" ${attrs(l)} aria-label="${l.aria}">${l.icon}<span>${l.label}</span></a>`).join('');
  }

  // Compact COMMUNITY block (footer / community sections)
  function communityBlock() {
    return '<div class="footer-community">' +
      '<h5>Community</h5>' +
      '<div class="social-links">' + pillLinks() + '</div>' +
      '<p class="social-note">Follow BooyahX for official updates, announcements and new content.</p>' +
      '</div>';
  }

  // Inject COMMUNITY into page footers that don't already have official links.
  function inject() {
    try {
      document.querySelectorAll('.footer .container').forEach(container => {
        if (container.querySelector('[data-official-social]')) return; // already present
        container.insertAdjacentHTML('afterbegin', communityBlock());
      });
      // Explicit placement slots (about/support etc.)
      document.querySelectorAll('[data-community-links]').forEach(slot => {
        if (slot.querySelector('[data-official-social]')) return;
        slot.innerHTML = communityBlock();
      });
    } catch (_) { /* never break the page over social links */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  return { LINKS, iconLinks, pillLinks, communityBlock };
})();
