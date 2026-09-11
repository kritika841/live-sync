"use client";
import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  value?: string;
  placeholder?: string;
};
export default function OperationsForm({
  title,

  fields,
  onSave,
  button = "Save",
  children,
  busy = false,
}: {
  title: string;
  description?: string;
  fields: Field[];
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
  button?: string;
  children?: React.ReactNode;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    try {
      if (await onSave(Object.fromEntries(new FormData(form)))) {form.reset();setOpen(false);} else setError("Could not save. Check the required fields and connection.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  }
  return (
    <><button className="action-launch" onClick={()=>setOpen(true)}>+ {title}</button><Modal title={title} open={open} onClose={()=>setOpen(false)} busy={busy} wide={!!children}><form className="ops-form" onSubmit={submit}>
      <div className="ops-fields">
        {fields.map((f) => (
          <label key={f.name}>
            <span>{f.label}</span>
            {f.options ? (
              <select
                name={f.name}
                defaultValue={f.value || ""}
                required={f.required !== false}
              >
                <option value="">Select…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                name={f.name}
                defaultValue={f.value}
                required={f.required !== false}
              />
            ) : (
              <input
                name={f.name}
                type={f.type || "text"}
                step={f.type === "number" ? "any" : undefined}
                min={f.type === "number" ? 0 : undefined}
                defaultValue={f.value}
                placeholder={f.placeholder}
                required={f.required !== false}
              />
            )}
          </label>
        ))}
      </div>
      {children}
      {error && (
        <p className="ops-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="ops-primary" disabled={busy}>
          {busy ? "Saving…" : button}
        </button>
      </footer>
    </form></Modal></>
  );
}
