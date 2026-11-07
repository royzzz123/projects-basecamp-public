import { useState, type FormEvent, useRef, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { login, ApiError } from "@/lib/api";
import { Eye, EyeOff, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — OnFinance AI" }] }),
  component: LoginPage,
});

// ── WebGL animated mesh ──────────────────────────────────────────────────────

const VERT = `attribute vec2 a_pos; void main(){gl_Position=vec4(a_pos,0,1);}`;
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  uv.y=1.-uv.y;
  float t=u_time*.00012;

  vec2 p0=vec2(.30+sin(t*.70)*.25,.25+cos(t*.60)*.20);
  vec2 p1=vec2(.75+cos(t*.50)*.20,.70+sin(t*.80)*.20);
  vec2 p2=vec2(.50+sin(t*.40+1.)*.30,.50+cos(t*.70)*.25);
  vec2 p3=vec2(.20+cos(t*.55)*.20,.85+sin(t*.45)*.15);

  float r=.55;
  float d0=pow(1.-smoothstep(0.,r,distance(uv,p0)),1.4);
  float d1=pow(1.-smoothstep(0.,r,distance(uv,p1)),1.4);
  float d2=pow(1.-smoothstep(0.,r,distance(uv,p2)),1.4);
  float d3=pow(1.-smoothstep(0.,r,distance(uv,p3)),1.4);

  float tot=d0+d1+d2+d3+.0001;
  vec3 c0=vec3(.05,.08,.18);
  vec3 c1=vec3(.10,.30,.50);
  vec3 c2=vec3(.40,.18,.58);
  vec3 c3=vec3(.06,.10,.20);
  vec3 col=(c0*d0+c1*d1+c2*d2+c3*d3)/tot;

  float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  col+=(n-.5)*.022;
  gl_FragColor=vec4(col,1.);
}`;

function MeshCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");

    const ro = new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    });
    ro.observe(canvas);

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, now - start);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}

// ── Left panel ───────────────────────────────────────────────────────────────

function LeftPanel() {
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:flex-col">
      <MeshCanvas />
      {/* vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(130% 90% at 50% 50%, transparent 30%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      <div className="relative flex h-full flex-col justify-between p-12">
        {/* Spacer to push content to bottom */}
        <div />

        {/* Bottom copy */}
        <div className="max-w-sm">
          <div className="mb-4 inline-flex items-center rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-white/60 backdrop-blur-sm">
            SEBI Complaint Management Tool
          </div>
          <h2
            className="text-3xl font-semibold leading-snug text-white"
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.5)" }}
          >
            Complaint intelligence,
            <br />
            <span className="text-white/55">at your fingertips.</span>
          </h2>
          <p
            className="mt-4 text-sm leading-relaxed text-white/55"
            style={{ textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}
          >
            Monitor registered intermediaries, track investor grievances, and surface AI-powered
            signals — all in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {["Real-time alerts", "AI Insights", "SLA Tracking"].map((f) => (
              <span
                key={f}
                className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] text-white/60 backdrop-blur-sm"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Right panel ──────────────────────────────────────────────────────────────

function RightPanel() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setPending(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate({ to: "/" });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Invalid email or password." : err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="mb-8">
          <img src="/onfi_logo.svg" alt="OnFinance AI" className="h-7 w-auto" />
        </div>

        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Welcome back</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Sign in to your SEBI account to continue.
        </p>

        {/* Form */}
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[12px] font-medium text-foreground">
              Email <span className="text-muted-foreground">*</span>
            </label>
            <Input
              id="email"
              type="email"
              required
              placeholder="you@sebi.gov.in"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-xl border-border bg-background text-[13px] shadow-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[12px] font-medium text-foreground">
              Password <span className="text-muted-foreground">*</span>
            </label>
            <div className="relative">
              <Input
                id="password"
                type={reveal ? "text" : "password"}
                required
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 rounded-xl border-border bg-background pr-10 text-[13px] shadow-sm"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <HugeiconsIcon icon={reveal ? EyeOff : Eye} className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600 border border-red-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={cn(
              "mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-neutral-800 disabled:opacity-60",
            )}
          >
            {pending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                Sign in
                <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" strokeWidth={2} />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between text-[12px]">
          <span className="text-muted-foreground">
            No account?{" "}
            <a href="#" className="font-medium text-foreground hover:underline">
              Request access
            </a>
          </span>
          <a href="#" className="text-muted-foreground hover:text-foreground hover:underline">
            Forgot password?
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function LoginPage() {
  return (
    <div className="grid h-screen w-screen overflow-hidden lg:grid-cols-[1fr_minmax(420px,520px)]">
      <LeftPanel />
      <RightPanel />
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0">
      <path
        fill="#EA4335"
        d="M12 5c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.5 15 .5 12 .5 7.3.5 3.3 3.2 1.4 7.1l3.8 3c.9-2.8 3.5-4.6 6.8-4.6Z"
      />
      <path
        fill="#34A853"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.7-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.6Z"
      />
      <path
        fill="#FBBC05"
        d="M5.2 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1l-3.8-3C.5 8.7 0 10.3 0 12s.5 3.3 1.4 4.7l3.8-2.6Z"
      />
      <path
        fill="#4285F4"
        d="M12 23.5c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.3 0-6-2-6.9-4.6l-3.8 3C3.3 20.8 7.3 23.5 12 23.5Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0">
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#00a4ef" d="M13 1h10v10H13z" />
      <path fill="#7fba00" d="M1 13h10v10H1z" />
      <path fill="#ffb900" d="M13 13h10v10H13z" />
    </svg>
  );
}
