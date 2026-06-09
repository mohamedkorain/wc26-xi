// Auth helpers shared across pages.
import { supabase } from './supabase-client.js';
import { t } from './i18n.js';

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
  const render = async () => {
    const user = await currentUser();
    if (user) {
      const name = await getDisplayName(user);
      el.innerHTML = `
        <span class="hdr-email" title="${escapeAttr(user.email)}">${escapeHtml(name || shortEmail(user.email))}</span>
        <button class="hdr-btn" id="editNameBtn" title="${t('auth.editname')}" style="padding:4px 8px;font-size:11px;">✎</button>
        <button class="hdr-btn" id="signOutBtn">${t('auth.signout')}</button>
      `;
      el.querySelector('#signOutBtn').onclick = signOut;
      el.querySelector('#editNameBtn').onclick = async () => {
        await editDisplayName(user, name);
        render();
        window.dispatchEvent(new CustomEvent('displaynamechange'));
      };
      // Soft-prompt for display name on first sign-in
      if (!name) {
        setTimeout(async () => {
          await editDisplayName(user, '');
          render();
          window.dispatchEvent(new CustomEvent('displaynamechange'));
        }, 200);
      }
    } else {
      el.innerHTML = `<a href="login.html" class="hdr-btn primary">${t('auth.signin')}</a>`;
    }
  };
  await render();
  window.addEventListener('langchange', render);
}

async function getDisplayName(user) {
  const { data } = await supabase
    .from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  return data?.display_name || null;
}

async function editDisplayName(user, current) {
  const next = prompt(t('auth.nameprompt'), current || '');
  if (next == null) return;
  const trimmed = next.trim().slice(0, 40);
  if (!trimmed) return;
  const { error } = await supabase
    .from('profiles').update({ display_name: trimmed }).eq('id', user.id);
  if (error) alert(error.message);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

function shortEmail(e) {
  if (!e) return '';
  const [u, d] = e.split('@');
  return (u.length > 12 ? u.slice(0, 12) + '…' : u) + '@' + d;
}
