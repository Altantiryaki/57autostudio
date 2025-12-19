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

  // Premium Reveal on scroll (exclude footer)
  const all = qsa('.reveal');
  const els = all.filter(el => !el.closest('footer') && !el.closest('.footer'));

  // Stagger: auto delay inside common groups
  const staggerGroups = ['.hero__copy', '.trustRow', '.cards', '.steps', '.sectionHead'];
  staggerGroups.forEach(sel => {
    qsa(sel).forEach(group => {
      const kids = qsa('.reveal', group).filter(x => !x.closest('footer') && !x.closest('.footer'));
      kids.forEach((k, i) => k.style.setProperty('--d', `${i * 90}ms`));
    });
  });

  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (ent.isIntersecting) {
        ent.target.classList.add('is-in');
        io.unobserve(ent.target);
      }
    }
  }, { threshold: 0.18, rootMargin: "0px 0px -10% 0px" });

  els.forEach(el => io.observe(el));

  // Parallax background for .bgSection (Keynote vibe)
  const bgSections = qsa('.bgSection');
  let ticking = false;

  function updateParallax(){
    ticking = false;
    const vh = window.innerHeight;

    bgSections.forEach(sec => {
      const r = sec.getBoundingClientRect();
      const t = ((r.top + r.height * 0.5) - vh * 0.5) / (vh * 0.9);
      const p = Math.max(-1, Math.min(1, t));
      sec.style.setProperty('--p', `${p * 28}px`);
    });
  }

  function onScroll(){
    if (!ticking){
      ticking = true;
      requestAnimationFrame(updateParallax);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  // Specular highlight for glass6
  qsa('.glass6').forEach(el => {
    el.addEventListener('pointermove', (ev) => {
      const r = el.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 100;
      const y = ((ev.clientY - r.top) / r.height) * 100;
      el.style.setProperty('--mx', `${x}%`);
      el.style.setProperty('--my', `${y}%`);
      el.classList.add('is-hot');
    });
    el.addEventListener('pointerleave', () => el.classList.remove('is-hot'));
  });

  // Subtle magnetic hover for pills (desktop-ish feel)
  qsa('.pill').forEach(el => {
    el.addEventListener('pointermove', (ev) => {
      const r = el.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width/2)) / r.width;
      const dy = (ev.clientY - (r.top + r.height/2)) / r.height;
      el.style.transform = `translate3d(${dx * 6}px, ${dy * 6}px, 0)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  });


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

// =========================
// KEYNOTE PRO PACK (ADD-ON)
// =========================
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  // A) Scroll progress bar
  let bar = document.querySelector(".scrollProg");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "scrollProg";
    document.body.appendChild(bar);
  }

  // B) Kinetic split (opt-in): add data-kinetic on headings
  const kineticEls = [...document.querySelectorAll("[data-kinetic]")];
  kineticEls.forEach(el => {
    if (el.dataset.kineticDone) return;
    el.dataset.kineticDone = "1";
    el.classList.add("kinetic");

    const text = el.textContent;
    el.textContent = "";
    const words = text.split(/(\s+)/); // keep spaces
    let wi = 0;
    words.forEach(w => {
      if (/^\s+$/.test(w)) {
        el.appendChild(document.createTextNode(w));
      } else {
        const span = document.createElement("span");
        span.className = "w";
        span.style.setProperty("--wi", wi++);
        span.textContent = w;
        el.appendChild(span);
      }
    });
  });

  // C) Spotlight (opt-in): add class "spotlight" on sections
  const spotSecs = [...document.querySelectorAll(".spotlight")];

  // D) Shimmer (opt-in): add class "shimmer" on elements you want to sweep
  const shimmerEls = [...document.querySelectorAll(".shimmer")];

  // E) Tilt (opt-in): add data-tilt on cards/glass
  const tiltEls = [...document.querySelectorAll("[data-tilt]")];

  // F) Divider glow progress (opt-in): add .divGlow element inside a section
  const divGlows = [...document.querySelectorAll(".divGlow")];

  // Keep footer excluded from motion (your rule)
  const isInFooter = (el) => el.closest("footer") || el.closest(".footer");

  // Hook kinetic into existing reveal: when .reveal becomes is-in, also mark kinetic
  const obs = new MutationObserver((muts) => {
    muts.forEach(m => {
      if (m.type === "attributes" && m.attributeName === "class") {
        const el = m.target;
        if (el.classList.contains("is-in")) {
          if (el.matches("[data-kinetic]")) el.classList.add("is-in");
          if (el.classList.contains("shimmer") && !isInFooter(el)) {
            // fire shimmer once
            el.classList.add("is-shimmer");
            setTimeout(() => el.classList.remove("is-shimmer"), 1600);
          }
        }
      }
    });
  });

  // Observe reveal elements (already exist) to add shimmer/kinetic without touching your IO
  document.querySelectorAll(".reveal").forEach(el => {
    if (!isInFooter(el)) obs.observe(el, { attributes: true });
  });

  // Tilt interactions
  tiltEls.forEach(el => {
    if (isInFooter(el)) return;
    el.classList.add("tilt");

    el.addEventListener("pointermove", (ev) => {
      const r = el.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width;   // 0..1
      const py = (ev.clientY - r.top) / r.height;   // 0..1
      const ry = (px - 0.5) * 10;                   // deg
      const rx = (0.5 - py) * 10;                   // deg
      const tx = (px - 0.5) * 6;                    // px
      const ty = (py - 0.5) * 6;                    // px
      el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      el.style.setProperty("--tx", `${tx.toFixed(2)}px`);
      el.style.setProperty("--ty", `${ty.toFixed(2)}px`);
    }, { passive: true });

    el.addEventListener("pointerleave", () => {
      el.style.setProperty("--rx", `0deg`);
      el.style.setProperty("--ry", `0deg`);
      el.style.setProperty("--tx", `0px`);
      el.style.setProperty("--ty", `0px`);
    });
  });

  // Scroll loop (progress + spotlight + divider glow)
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;

      const doc = document.documentElement;
      const max = (doc.scrollHeight - window.innerHeight) || 1;
      const p = (window.scrollY / max) * 100;
      doc.style.setProperty("--sp", p.toFixed(3));

const vh = window.innerHeight;

// Spotlight nur für Sections, die wirklich im Viewport sind
spotSecs.forEach(sec => {
  if (isInFooter(sec)) return;
  const r = sec.getBoundingClientRect();
  if (r.bottom < 0 || r.top > vh) return; // <-- wichtig

  const cx = 50;
  const cy = ((vh * 0.5 - r.top) / (r.height || 1)) * 100;
  sec.style.setProperty("--sx", `${cx}%`);
  sec.style.setProperty("--sy", `${Math.max(15, Math.min(85, cy))}%`);
});

// Divider glow nur wenn sichtbar
divGlows.forEach(line => {
  if (isInFooter(line)) return;
  const sec = line.closest("section") || line.parentElement;
  const r = sec.getBoundingClientRect();
  if (r.bottom < 0 || r.top > vh) return; // <-- wichtig

  const t = (vh * 0.65 - r.top) / (r.height || 1);
  const dp = Math.max(0, Math.min(1, t));
  line.style.setProperty("--dp", dp.toFixed(3));
});
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
})();
