import { useCallback, useEffect, useState } from "react";
import {
  fmtInt,
  fmtMetric,
  signatureApi,
  type Comparison,
  type Insight,
  type PrivacyReport,
  type PrivacyTest,
  type Radar,
  type Release,
} from "../api";

/**
 * The three signature features of the console:
 *   - the Change Radar: what changed around a release,
 *   - the Fix-to-Proof: what to do and whether it worked,
 *   - the Privacy Gate: what the browser never sent.
 *
 * The panels read the same design system as the rest of the console (card,
 * stack, bars, pill) so the page does not look like a second product.
 */

/* ------------------------------------------------------------- utilities */

function verdictPill(verdict: Comparison["verdict"]): { label: string; className: string } {
  if (verdict === "regression") return { label: "regresyon", className: "pill pill--error" };
  if (verdict === "improvement") return { label: "iyileşme", className: "pill pill--ok" };
  if (verdict === "stable") return { label: "değişim yok", className: "pill" };
  return { label: "yeterli veri yok", className: "pill pill--wait" };
}

function outcomePill(outcome: string): { label: string; className: string } {
  if (outcome === "improved") return { label: "düzeltildi", className: "pill pill--ok" };
  if (outcome === "regressed") return { label: "kötüleşti", className: "pill pill--error" };
  if (outcome === "inconclusive") return { label: "belirsiz", className: "pill" };
  return { label: "yeterli veri yok", className: "pill pill--wait" };
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "payload" in error) {
    const payload = (error as { payload: { message?: string; error?: string } }).payload;
    if (payload?.message) return payload.message;
    if (payload?.error) return payload.error;
  }
  return "İstek başarısız.";
}

/* ========================================================== Change Radar */

export function ChangeRadar({ projectId }: { projectId: string }) {
  const [radar, setRadar] = useState<Radar | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [window, setWindow] = useState("24h");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [result, list] = await Promise.all([
        signatureApi.radar(projectId, window),
        signatureApi.releases(projectId),
      ]);
      setRadar(result);
      setReleases(list.releases);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [projectId, window]);

  useEffect(() => {
    void load();
  }, [load]);

  const addRelease = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = version.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await signatureApi.addRelease(projectId, trimmed);
      setVersion("");
      setMessage(`"${trimmed}" işareti eklendi.`);
      await load();
    } catch (addError) {
      setError(errorText(addError));
    } finally {
      setBusy(false);
    }
  };

  const release = radar?.release ?? null;
  const metrics = radar?.metrics ?? [];

  return (
    <div className="stack">
      <div className="row">
        <h3 className="card__title" style={{ margin: 0 }}>
          Değişim Radarı
        </h3>
        <div className="console__range" style={{ marginLeft: "auto" }} role="group" aria-label="Pencere">
          {["1h", "6h", "24h", "7d"].map((key) => (
            <button
              key={key}
              type="button"
              className={window === key ? "is-active" : undefined}
              onClick={() => setWindow(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}
      {message ? <p className="alert alert--ok">{message}</p> : null}

      {radar?.empty ? (
        <div className="card stack">
          <p className="card__text">
            {radar.message ??
              "Henüz bir sürüm işareti yok. Uygulamanızda dynamic.release('sürüm') çağırın ya da elle ekleyin."}
          </p>
        </div>
      ) : null}

      {release ? (
        <>
          <div className="card stack">
            <div className="row">
              <div>
                <h4 className="card__title" style={{ margin: 0 }}>
                  Sürüm {release.version}
                </h4>
                <p className="card__text" style={{ margin: 0 }}>
                  {new Date(release.deployedAt).toLocaleString("tr-TR")} · {radar?.windowLabel} öncesi ve
                  sonrası karşılaştırıldı · en az {radar?.minSamples} örnek gerekir.
                </p>
              </div>
            </div>
            {radar?.note ? <p className="card__text">{radar.note}</p> : null}
          </div>

          <div className="card stack">
            <h4 className="card__title">Metrikler</h4>
            {metrics.length === 0 ? (
              <p className="card__text">Bu pencerede ölçüm yok.</p>
            ) : (
              <ul className="list">
                {metrics.map((metric) => {
                  const pill = verdictPill(metric.verdict);
                  return (
                    <li className="item" key={metric.metric}>
                      <div className="item__body">
                        <div className="row">
                          <b>{metric.metric}</b>
                          <span className={pill.className}>{pill.label}</span>
                        </div>
                        <p className="card__text" style={{ margin: 0 }}>
                          Önce: {metric.before.p75 === null ? "—" : fmtMetric(metric.metric, metric.before.p75)} (
                          {fmtInt(metric.before.samples)} örnek) · Sonra:{" "}
                          {metric.after.p75 === null ? "—" : fmtMetric(metric.metric, metric.after.p75)} (
                          {fmtInt(metric.after.samples)} örnek)
                        </p>
                        <small className="faint">{metric.reason}</small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {radar?.errors ? (
            <div className="card stack">
              <h4 className="card__title">Hata oranı</h4>
              <div className="row">
                <span className={verdictPill(radar.errors.verdict).className}>
                  {verdictPill(radar.errors.verdict).label}
                </span>
                <p className="card__text" style={{ margin: 0 }}>
                  {radar.errors.reason}
                </p>
              </div>
            </div>
          ) : null}

          {radar?.segments?.length ? (
            <div className="card stack">
              <h4 className="card__title">Segmentler</h4>
              <ul className="list list--tight">
                {radar.segments.map((segment) => (
                  <li key={segment.scope}>
                    <b>{segment.scope}</b>
                    <span className="faint">
                      {segment.metrics
                        .filter((metric) => metric.verdict !== "stable" && metric.verdict !== "insufficient_data")
                        .map((metric) => `${metric.metric}: ${metric.reason}`)
                        .join(" · ") || "değişen ölçüm yok"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {radar?.timeline?.metrics?.LCP?.length ? (
            <div className="card stack">
              <h4 className="card__title">Zaman çizelgesi (LCP p75)</h4>
              <ul className="bars">
                {radar.timeline.metrics.LCP.map((point) => (
                  <li key={point.t}>
                    <div className="bars__top">
                      <span className="bars__label">
                        {new Date(point.t).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <span className="bars__value">
                        {point.p75 === null ? "—" : fmtMetric("LCP", point.p75)}
                        <em>{fmtInt(point.samples)} örnek</em>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="card stack">
        <h4 className="card__title">Sürüm işareti ekle</h4>
        <p className="card__text">
          Uygulama tarafında <code className="mono">dynamic.release("2026.10.4")</code> çağrısı da aynı işareti
          yapar. Buradan elle ekleyebilirsiniz.
        </p>
        <form className="row" onSubmit={addRelease}>
          <input
            className="field__control"
            placeholder="2026.10.4"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            aria-label="Sürüm"
          />
          <button className="button" type="submit" disabled={busy || !version.trim()}>
            İşaretle
          </button>
        </form>
        {releases.length ? (
          <ul className="list list--tight">
            {releases.map((item) => (
              <li key={item.id} className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono">{item.version}</span>
                <span className="faint">
                  {new Date(item.deployedAt).toLocaleString("tr-TR")} · {item.source}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ========================================================== Fix-to-Proof */

const STATUS_LABELS: Record<Insight["status"], string> = {
  open: "açık",
  investigating: "inceleniyor",
  fixed: "düzeltildi",
  dismissed: "kapatıldı",
};

export function InsightPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ issues: Insight[]; note?: string; period: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [insights, list] = await Promise.all([
        signatureApi.insights(projectId, "24h"),
        signatureApi.releases(projectId),
      ]);
      setData(insights);
      setReleases(list.releases);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = async (issue: Insight, status: Insight["status"]) => {
    setBusy(true);
    setError(null);
    try {
      const releaseId = selected[issue.fingerprint] ? Number(selected[issue.fingerprint]) : null;
      await signatureApi.setInsight(projectId, issue.fingerprint, { status, releaseId });
      await load();
    } catch (markError) {
      setError(errorText(markError));
    } finally {
      setBusy(false);
    }
  };

  const issues = data?.issues ?? [];

  return (
    <div className="stack">
      <div className="row">
        <h3 className="card__title" style={{ margin: 0 }}>
          Fix-to-Proof
        </h3>
        <button className="button button--ghost" type="button" onClick={() => void load()} disabled={busy}>
          Yenile
        </button>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}
      {data?.note ? <p className="card__text">{data.note}</p> : null}

      {issues.length === 0 ? (
        <div className="card stack">
          <p className="card__text">
            Ölçülen verilerde acil bir sorun görünmüyor. Öneriler yalnızca yeterli örnek varsa üretilir.
          </p>
        </div>
      ) : null}

      {issues.map((issue) => (
        <div className="card stack" key={issue.fingerprint}>
          <div className="row">
            <b>{issue.title}</b>
            <span className={issue.severity === "critical" ? "pill pill--error" : "pill pill--wait"}>
              {issue.severity}
            </span>
            <span className="pill">{STATUS_LABELS[issue.status]}</span>
          </div>
          <p className="card__text" style={{ margin: 0 }}>
            {issue.reason}
          </p>
          <small className="faint">
            {issue.measurement}: {issue.value} · {fmtInt(issue.samples)} örnek
            {issue.scope !== "all" ? ` · ${issue.scope}` : ""}
          </small>

          <ul className="list">
            {issue.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {issue.code ? (
            <pre className="code">
              <span className="faint">{issue.code.label}</span>
              {"\n"}
              {issue.code.snippet}
            </pre>
          ) : null}

          {issue.assessment ? (
            <div className="row">
              <span className={outcomePill(issue.assessment.outcome).className}>
                {outcomePill(issue.assessment.outcome).label}
              </span>
              <span className="faint">{issue.assessment.reason}</span>
            </div>
          ) : null}

          <div className="row">
            <select
              className="field__control"
              aria-label="Düzeltme ile ilişkili sürüm"
              value={selected[issue.fingerprint] ?? ""}
              onChange={(event) =>
                setSelected((current) => ({ ...current, [issue.fingerprint]: event.target.value }))
              }
            >
              <option value="">Sürüm seç (opsiyonel)</option>
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.version}
                </option>
              ))}
            </select>
            <button
              className="button button--ghost"
              type="button"
              disabled={busy}
              onClick={() => void mark(issue, "investigating")}
            >
              İnceleniyor
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void mark(issue, "fixed")}
            >
              Düzeltildi
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={busy}
              onClick={() => void mark(issue, "dismissed")}
            >
              Kapat
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================== Privacy Gate */

export function PrivacyPanel({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<PrivacyReport | null>(null);
  const [test, setTest] = useState<PrivacyTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await signatureApi.privacy(projectId));
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runTest = async () => {
    setBusy(true);
    setError(null);
    try {
      setTest(await signatureApi.privacyTest(projectId));
    } catch (testError) {
      setError(errorText(testError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <h3 className="card__title" style={{ margin: 0 }}>
          Gizlilik Kapısı
        </h3>
        <button className="button button--ghost" type="button" onClick={() => void load()} disabled={busy}>
          Yenile
        </button>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}
      {report?.note ? <p className="card__text">{report.note}</p> : null}

      <div className="card stack">
        <h4 className="card__title">Etkin kurallar</h4>
        <ul className="list">
          <li>Hassas alan adları (e-posta, parola, token, kart…) asla toplanmaz.</li>
          <li>
            Değer biçimi şüpheli olanlar engellenir:{" "}
            {report?.rules.valuePatterns.join(", ") || "e-posta, token, kart, telefon, T.C. kimlik"}
          </li>
          <li>URL'lerdeki hassas sorgu parametreleri kaldırılır.</li>
          <li>Yol içindeki token benzeri segmentler değiştirilir.</li>
          <li>Hata mesajları da aynı kurallardan geçer.</li>
          <li>Sunucu, gelen paketi bağımsız olarak yeniden doğrular.</li>
        </ul>
      </div>

      <div className="card stack">
        <h4 className="card__title">Engellenen alanlar</h4>
        {report && report.counters.length ? (
          <ul className="bars">
            {report.counters.map((row) => (
              <li key={row.category}>
                <div className="bars__top">
                  <span className="bars__label">{row.category}</span>
                  <span className="bars__value">{fmtInt(row.count)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card__text">Henüz engellenen bir alan yok.</p>
        )}
        <p className="card__text">
          Toplam: {fmtInt(report?.total ?? 0)} adet. Değerlerin kendisi sunucuya hiç gönderilmez, yalnızca
          sayıları sayılır.
        </p>
      </div>

      <div className="card stack">
        <h4 className="card__title">Uydurma değerlerle test</h4>
        <p className="card__text">
          Test değerleri uydurmadır; hiçbir yere gönderilmez ve saklanmaz. Amaç kuralların beklenen gibi
          çalıştığını görmektir.
        </p>
        <button className="button" type="button" onClick={() => void runTest()} disabled={busy}>
          Testi çalıştır
        </button>
        {test ? (
          <ul className="list">
            {test.samples.map((sample) => (
              <li key={sample.label} className="row" style={{ justifyContent: "space-between" }}>
                <span>{sample.label}</span>
                <span className={sample.blocked ? "pill pill--ok" : "pill"}>
                  {sample.blocked ? "engellendi" : "geçti"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
