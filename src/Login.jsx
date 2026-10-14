import React, { useEffect, useRef, useState } from "react";
import { C, Tap, inputStyle } from "./ui.jsx";

/* ------------------------------------------------------------------ */
/*  Login — sign in, create an account, or reset a password.            */
/*                                                                      */
/*  Built from the same pieces as the Onboard screen: same column,      */
/*  same amber wordmark overline, same heading scale, same cards,       */
/*  same Tap button and input style.                                    */
/*                                                                      */
/*  It does not talk to Firebase itself. App passes in `api`:           */
/*    signIn(email, password)   -> user                                 */
/*    register(email, password) -> user                                 */
/*    resetPassword(email)      -> void                                 */
/*  or null when no backend is configured, in which case the form is    */
/*  shown but disabled, with a plain explanation.                       */
/*  Errors are read from err.code (Firebase's codes).                   */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const COPY = {
  signin: {
    title: <>Welcome<br />back.</>,
    sub: "Sign in to pick your plan up where you left it, on any device.",
    cta: "Sign in", busy: "Signing in…",
  },
  register: {
    title: <>Don't lose<br />your plan.</>,
    sub: "Right now it only lives on this device. An account keeps it for you on any phone or browser.",
    cta: "Create account", busy: "Creating account…",
  },
  reset: {
    title: <>Reset your<br />password.</>,
    sub: "Enter your email and we'll send you a link to choose a new one.",
    cta: "Send reset link", busy: "Sending…",
  },
};

/* Firebase error code -> something a person can act on. `field` pins the
   message to an input, `action` offers a one-tap way forward. */
function explain(err) {
  switch (err?.code) {
    case "auth/invalid-email":
      return { field: "email", text: "That doesn't look like an email address." };
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return { text: "That email and password don't match. Check them and try again." };
    case "auth/user-disabled":
      return { text: "This account has been disabled." };
    case "auth/too-many-requests":
      return { text: "Too many attempts. Wait a few minutes, or reset your password." };
    case "auth/network-request-failed":
      return { text: "Can't reach the server. Check your connection and try again." };
    case "auth/email-already-in-use":
    case "auth/credential-already-in-use":
      return { text: "That email already has an account.", action: "signin" };
    case "auth/weak-password":
      return { field: "password", text: `That password is too weak. Use at least ${MIN_PASSWORD} characters.` };
    case "auth/operation-not-allowed":
      return { text: "Email sign-in isn't switched on for this app yet. Enable Email/Password in the Firebase console." };
    case "app/load-failed":
      return { text: "Couldn't load your saved plan, so nothing was changed. Check your connection and try again." };
    default:
      return { text: "Something went wrong. Try again in a moment." };
  }
}

function validate(mode, email, password) {
  const out = {};
  const e = email.trim();
  if (!e) out.email = "Enter your email.";
  else if (!EMAIL_RE.test(e)) out.email = "That doesn't look like an email address.";
  if (mode !== "reset") {
    if (!password) out.password = mode === "register" ? "Choose a password." : "Enter your password.";
    else if (mode === "register" && password.length < MIN_PASSWORD) {
      out.password = `Use at least ${MIN_PASSWORD} characters.`;
    }
  }
  return out;
}

const lbl = { fontSize: 13, color: C.dim, display: "block" };
const errText = { fontSize: 12.5, color: C.red, marginTop: 8, lineHeight: 1.5 };

const css = `
  .auth-field { transition: border-color .2s ease, box-shadow .2s ease }
  .auth-field::placeholder { color: #8592A4; opacity: 1 }  /* a touch lighter than dim so it clears 4.5:1 on the field */
  .auth-field:focus { outline: 2px solid transparent; box-shadow: 0 0 0 1px ${C.amber}, 0 0 0 4px rgba(242,169,59,.16) }
  .auth-field:-webkit-autofill { -webkit-text-fill-color: ${C.text}; -webkit-box-shadow: 0 0 0 40px ${C.cardHi} inset; caret-color: ${C.text} }
  .auth-link { appearance: none; background: none; border: none; padding: 4px 0; font: inherit; font-size: 13px; font-weight: 600; color: ${C.amber}; cursor: pointer; border-radius: 6px; transition: opacity .18s ease }
  .auth-link:hover { opacity: .8 }
  .auth-eye { color: ${C.dim}; transition: color .18s ease }
  .auth-eye:hover, .auth-eye:focus-visible { color: ${C.text} }
  .auth-slash { transition: stroke-dashoffset .28s cubic-bezier(.32,.72,0,1) }
  @keyframes authspin { to { transform: rotate(360deg) } }
  .auth-spin { animation: authspin .8s linear infinite; transform-origin: 50% 50% }
  @media (prefers-reduced-motion: reduce) { .auth-spin { animation: none } }
`;

function Eye({ off }) {
  // `off` draws the slash: the icon shows the action, so it is slashed while
  // the password is visible (press to hide it)
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path className="auth-slash" d="M4 4l16 16" strokeDasharray="23" strokeDashoffset={off ? 0 : 23} />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="auth-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export default function Login({ startMode = "signin", api, hasPlan, firstRun, onDone, onClose }) {
  const [mode, setMode] = useState(startMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const emailRef = useRef(null);
  const passRef = useRef(null);

  const unavailable = !api;
  const copy = COPY[mode];

  /* Switching mode rebuilds the form, which drops focus onto <body> (the
     link that was just pressed no longer exists). Put it back in the form:
     on the first empty field, or the email when everything is filled. */
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;   // only on a real switch, not on mount
    prevMode.current = mode;
    const wantsPassword = mode !== "reset" && email.trim() && !password;
    (wantsPassword ? passRef : emailRef).current?.focus();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m);
    setPassword("");
    setShow(false);
    setErrors({});
    setFormError(null);
    setSent(false);
  };

  const setField = (name, value) => {
    (name === "email" ? setEmail : setPassword)(value);
    if (errors[name] || formError) {
      // clear a field's message the moment it is fixed; drop the banner on any edit
      const next = validate(mode, name === "email" ? value : email, name === "password" ? value : password);
      setErrors((p) => ({ ...p, [name]: next[name] }));
      setFormError(null);
    }
  };

  const blurCheck = (name) => {
    const v = name === "email" ? email : password;
    if (!v && !errors[name]) return;   // don't nag a field nobody has touched
    setErrors((p) => ({ ...p, [name]: validate(mode, email, password)[name] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || unavailable) return;
    const found = validate(mode, email, password);
    setErrors(found);
    if (found.email) { emailRef.current?.focus(); return; }
    if (found.password) { passRef.current?.focus(); return; }

    setBusy(true);
    setFormError(null);
    try {
      const addr = email.trim();
      if (mode === "reset") {
        try { await api.resetPassword(addr); }
        catch (err) { if (err?.code !== "auth/user-not-found") throw err; } // same answer either way
        setSent(true);
      } else if (mode === "register") {
        const user = await api.register(addr, password);
        await onDone(user, "register");
      } else {
        const user = await api.signIn(addr, password);
        await onDone(user, "signin");
      }
    } catch (err) {
      const m = explain(err);
      if (m.field) {
        setErrors({ [m.field]: m.text });
        (m.field === "email" ? emailRef : passRef).current?.focus();
      } else {
        setFormError(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = (bad) => ({
    ...inputStyle,
    outline: undefined,                 // let the .auth-field focus ring show
    border: `1px solid ${bad ? C.red : C.line}`,
  });

  return (
    <div style={{ padding: "72px 24px 40px" }}>
      <style>{css}</style>

      <div className="rise" style={{ fontSize: 13, color: C.amber, fontWeight: 600 }}>Feasible</div>
      <h1 key={mode} className="rise" style={{ fontSize: 36, lineHeight: 1.12, fontWeight: 700, letterSpacing: -1.1, margin: "14px 0 12px", animationDelay: ".05s" }}>
        {copy.title}
      </h1>
      <p key={mode + "-sub"} className="rise" style={{ color: C.dim, fontSize: 16, lineHeight: 1.55, margin: 0, maxWidth: 330, animationDelay: ".1s" }}>
        {copy.sub}
      </p>

      {unavailable && (
        <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginTop: 28, animationDelay: ".14s" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Accounts aren't available</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>
            Cloud sync isn't set up in this build. Your plan is still saved on this device.
          </div>
        </div>
      )}

      {sent ? (
        <div style={{ marginTop: 36 }}>
          <div role="status" className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>Check your email</div>
            </div>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
              If {email.trim()} has an account, a reset link is on its way. It can take a minute to arrive.
            </div>
          </div>
          <Tap className="focus-ring" onClick={() => switchMode("signin")} style={{ width: "100%", background: C.amber, color: "#181203", padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 }}>
            Back to sign in
          </Tap>
        </div>
      ) : (
        <form
          key={mode + "-form"}
          noValidate
          onSubmit={submit}
          aria-label={copy.cta}
          style={{ marginTop: 36 }}
        >
          <div className="rise" style={{ marginBottom: 18, animationDelay: ".14s" }}>
            <label htmlFor="auth-email" style={{ ...lbl, marginBottom: 8 }}>Email</label>
            <input
              ref={emailRef}
              id="auth-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com"
              className="auth-field"
              value={email}
              disabled={unavailable}
              aria-invalid={errors.email ? "true" : undefined}
              aria-describedby={errors.email ? "auth-email-err" : undefined}
              onChange={(e) => setField("email", e.target.value)}
              onBlur={() => blurCheck("email")}
              style={fieldStyle(errors.email)}
            />
            {errors.email && <div id="auth-email-err" className="rise" style={errText}>{errors.email}</div>}
          </div>

          {mode !== "reset" && (
            <div className="rise" style={{ marginBottom: 26, animationDelay: ".18s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <label htmlFor="auth-password" style={lbl}>Password</label>
                {mode === "signin" && (
                  <button type="button" className="auth-link focus-ring" onClick={() => switchMode("reset")} disabled={unavailable}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div style={{ position: "relative" }}>
                <input
                  ref={passRef}
                  id="auth-password"
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="auth-field"
                  value={password}
                  disabled={unavailable}
                  aria-invalid={errors.password ? "true" : undefined}
                  aria-describedby={[mode === "register" ? "auth-password-hint" : null, errors.password ? "auth-password-err" : null].filter(Boolean).join(" ") || undefined}
                  onChange={(e) => setField("password", e.target.value)}
                  onBlur={() => blurCheck("password")}
                  style={{ ...fieldStyle(errors.password), paddingRight: 52 }}
                />
                <Tap
                  className="auth-eye focus-ring"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  disabled={unavailable}
                  onClick={() => setShow((s) => !s)}
                  style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 48, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", borderRadius: 12 }}
                >
                  <Eye off={show} />
                </Tap>
              </div>
              {mode === "register" && !errors.password && (
                <div id="auth-password-hint" style={{ fontSize: 12.5, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
                  At least {MIN_PASSWORD} characters.
                </div>
              )}
              {errors.password && <div id="auth-password-err" className="rise" style={errText}>{errors.password}</div>}
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="rise"
              style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,107,107,.08)", border: "1px solid rgba(255,107,107,.32)", borderRadius: 14, padding: "12px 14px", marginBottom: 18, fontSize: 14, lineHeight: 1.5 }}
            >
              <div style={{ width: 6, height: 6, borderRadius: 99, background: C.red, marginTop: 8, flexShrink: 0 }} />
              <div>
                {formError.text}
                {formError.action && (
                  <>
                    {" "}
                    <button type="button" className="auth-link focus-ring" style={{ fontSize: 14 }} onClick={() => switchMode(formError.action)}>
                      Sign in instead
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <Tap
            type="submit"
            className="focus-ring"
            aria-busy={busy}
            aria-disabled={unavailable || undefined}
            disabled={unavailable}
            style={{
              width: "100%", background: C.amber, color: "#181203", padding: "17px 0",
              borderRadius: 16, fontSize: 17, fontWeight: 650,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              cursor: busy ? "progress" : unavailable ? "default" : "pointer",
            }}
          >
            {busy && <Spinner />}
            {busy ? copy.busy : copy.cta}
          </Tap>

          {mode === "signin" && hasPlan && !unavailable && (
            <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>
              Signing in swaps the plan on this device for the one saved to your account.
            </div>
          )}

          {mode !== "reset" && (
            <div style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 20 }}>
              {mode === "signin" ? "New here? " : "Already have an account? "}
              <button
                type="button"
                className="auth-link focus-ring"
                style={{ fontSize: 14 }}
                onClick={() => switchMode(mode === "signin" ? "register" : "signin")}
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </div>
          )}
          {mode === "reset" && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button type="button" className="auth-link focus-ring" style={{ fontSize: 14 }} onClick={() => switchMode("signin")}>
                Back to sign in
              </button>
            </div>
          )}
        </form>
      )}

      <div style={{ marginTop: 30, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
        <Tap
          className="focus-ring"
          onClick={onClose}
          style={{ width: "100%", background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "14px 0", borderRadius: 16, fontSize: 14.5, fontWeight: 600 }}
        >
          {firstRun ? "Continue without an account" : "Not now"}
        </Tap>
        <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
          {firstRun
            ? "Your plan stays on this device. You can sign in later under Time."
            : "Feasible works fine without an account."}
        </div>
      </div>
    </div>
  );
}
