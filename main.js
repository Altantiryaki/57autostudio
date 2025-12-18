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

  // Reviews rail: auto-scrolling (no avatars, only name + stars + text)
  const rail = qs('#reviewRail');
  if (rail) {
    hydrateReviews()
      .then((items) => {
        if (!items || !items.length) return;
        renderRail(items);
        enableAutoScroll();
      })
      .catch(() => {});
  }

  async function hydrateReviews(){
    // Option A: inline snippets
    if (Array.isArray(window.REVIEW_SNIPPETS) && window.REVIEW_SNIPPETS.length) {
      return window.REVIEW_SNIPPETS;
    }
    // Option B: local file
    try{
      const res = await fetch('./reviews.json', { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.items)) return data.items;
      return [];
    }catch{
      return [];
    }
  }

  function renderRail(snippets){
    const clamp = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    const safe = snippets
      .filter(Boolean)
      .map(r => ({
        name: clamp(String(r.name || "").trim(), 32),
        stars: Math.max(0, Math.min(5, Number(r.stars) || 5)),
        text: clamp(String(r.text || "").trim(), 190),
      }))
      .slice(0, 10);

    const doubled = safe.concat(safe);

    rail.innerHTML = doubled.map(r => {
      const stars = "★★★★★".slice(0, r.stars) + "☆☆☆☆☆".slice(0, 5 - r.stars);
      return `
        <article class="review">
          <div class="review__top">
            <div class="review__name">${escapeHtml(r.name)}</div>
            <div class="review__stars" aria-hidden="true">${stars}</div>
          </div>
          <div class="review__text">${escapeHtml(r.text)}</div>
        </article>
      `;
    }).join("");
  }

  function enableAutoScroll(){
    if (rail.scrollWidth <= rail.clientWidth + 10) return;

    let raf = null;
    let last = performance.now();
    const speed = 0.35; // px/ms

    const step = (t) => {
      const dt = t - last;
      last = t;

      rail.scrollLeft += dt * speed;

      const half = rail.scrollWidth / 2;
      if (rail.scrollLeft >= half) rail.scrollLeft -= half;

      raf = requestAnimationFrame(step);
    };

    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); } };

    rail.addEventListener('mouseenter', stop);
    rail.addEventListener('mouseleave', start);
    rail.addEventListener('touchstart', stop, { passive: true });
    rail.addEventListener('touchend', start, { passive: true });
    rail.addEventListener('wheel', stop, { passive: true });

    start();
  }

  function escapeHtml(str){
    return str.replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }
})();
