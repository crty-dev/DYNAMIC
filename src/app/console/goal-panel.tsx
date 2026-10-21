import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { projectsApi, type Goal } from "../api";

/**
 * The goals of a site: a named conversion that matches an event by its name
 * (or a path for a page goal). The definition belongs to the account that
 * owns the project, so it is managed through the project API.
 */
export function GoalPanel({
  projectId,
  goals,
  onChange,
}: {
  projectId: string;
  goals: Goal[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await projectsApi.createGoal(projectId, {
        name: name.trim(),
        label: label.trim() || undefined,
        path: path.trim() || undefined,
      });
      setName("");
      setLabel("");
      setPath("");
      setOpen(false);
      onChange();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "Hedef kaydedilemedi.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (goal: string) => {
    if (!window.confirm(`"${goal}" hedefi silinsin mi?`)) return;
    setBusy(true);
    setError(null);
    try {
      await projectsApi.deleteGoal(projectId, goal);
      onChange();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error && deleteError.message
          ? deleteError.message
          : "Hedef silinemedi.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="card__title" style={{ margin: 0 }}>
          Hedefler
        </h3>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Plus size={14} aria-hidden /> Hedef ekle
        </button>
      </div>

      {open ? (
        <form className="goal-form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Event adı</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="signup_clicked"
              pattern="[A-Za-z0-9_.:\-]+"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Etiket (isteğe bağlı)</span>
            <input
              className="field__input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Kayıt oldu"
              maxLength={120}
            />
          </label>
          <label className="field">
            <span className="field__label">Yol (isteğe bağlı)</span>
            <input
              className="field__input"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/kayit"
              maxLength={512}
            />
          </label>
          <p className="field__hint">
            Hedef, event adı ya da yol eşleştiğinde dönüşüm olarak sayılır.
          </p>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Hedefi kaydet"}
          </button>
        </form>
      ) : null}

      {error ? <p className="alert alert--error">{error}</p> : null}

      {goals.length === 0 ? (
        <p className="card__text">
          Henüz hedef yok. Bir event adı ekleyin, o event geldiğinde dönüşüm
          olarak sayılsın.
        </p>
      ) : (
        <ul className="list">
          {goals.map((goal) => (
            <li className="row" key={goal.public_id} style={{ justifyContent: "space-between" }}>
              <span>
                <b>{goal.label ?? goal.name}</b>{" "}
                <span className="faint mono">{goal.name}</span>
                {goal.path ? <span className="faint mono"> · {goal.path}</span> : null}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void remove(goal.public_id)}
                disabled={busy}
                aria-label={`${goal.name} hedefini sil`}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
