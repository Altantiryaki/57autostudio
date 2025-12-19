(() => {
  const qs = (s, el = document) => el.querySelector(s);
  const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

  // Year
  const yearEl = qs('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Topbar elevation on scroll
  const topbar = qs('.topbar');
  const setScrolled = () => {
    if (!topbar) return;
    topbar.setAttribute('data-scrolled', window.scrollY > 8 ? 'true' : 'false');
  };
  setScrolled();
  window.addEventListener('scroll', setScrolled, { passive: true });

  // Mobile nav
  const burger = qs('.burger');
  const mobileNav = qs('#mobileNav');
  const toggleMobile = () => {
    if (!burger || !mobileNav) return;
    const expanded = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    mobileNav.hidden = expanded ? true : false;
  };
  if (burger) burger.addEventListener('click', toggleMobile);

  if (mobileNav) {
    mobileNav.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      if (burger) burger.setAttribute('aria-expanded', 'false');
      mobileNav.hidden = true;
    });
  }

  // Reveal on scroll
  const els = qsa('.reveal');
  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (ent.isIntersecting) {
        ent.target.classList.add('is-in');
        io.unobserve(ent.target);
      }
    }
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));

  // Google Reviews (live via Worker endpoint /reviews)
  const track = qs('#reviews-track');
  if (track) loadReviews(track);

  async function loadReviews(trackEl){
    try{
      const resp = await fetch('/reviews', { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 8) : [];
      if (!reviews.length) return;

      const createCard = (r) => {
        const card = document.createElement('article');
        card.className = 'reviewCard';

        const rating = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 5)));
        const stars = '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating);

        card.innerHTML = `
          <div class="reviewCard__top">
            <div class="reviewCard__name">${escapeHtml(r.author_name || 'Kunde')}</div>
            <div class="reviewCard__time">${escapeHtml(r.relative_time || 'Google')}</div>
          </div>
          <div class="reviewCard__stars" aria-hidden="true">${stars}</div>
          <div class="reviewCard__text">${escapeHtml((r.text || '').trim())}</div>
        `;
        return card;
      };

      trackEl.innerHTML = '';
      reviews.forEach(r => trackEl.appendChild(createCard(r)));
      reviews.forEach(r => trackEl.appendChild(createCard(r))); // duplicate for loop
    }catch(e){
      console.error('Review-Loading failed', e);
    }
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }
})();
