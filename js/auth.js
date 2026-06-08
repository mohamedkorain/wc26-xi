// Auth helpers shared across pages.
import { supabase } from './supabase-client.js';

export async function currentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signInWithEmail(email, redirectTo) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.origin + '/' },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.reload();
}

// Render a small auth widget into a container element.
//   <div id="authSlot"></div>
//   mountAuthWidget(document.getElementById('authSlot'))
export async function mountAuthWidget(el) {
  const user = await currentUser();
  if (user) {
    el.innerHTML = `
      <a href="leagues.html" class="hdr-link">My leagues</a>
      <span class="hdr-email" title="${user.email}">${shortEmail(user.email)}</span>
      <button class="hdr-btn" id="signOutBtn">Sign out</button>
    `;
    el.querySelector('#signOutBtn').onclick = signOut;
  } else {
    el.innerHTML = `<a href="login.html" class="hdr-btn primary">Sign in</a>`;
  }
}

function shortEmail(e) {
  if (!e) return '';
  const [u, d] = e.split('@');
  return (u.length > 12 ? u.slice(0, 12) + '…' : u) + '@' + d;
}
