import { useEffect, useState } from "react";

/**
 * A number box you can type in freely. The text is kept as typed (so clearing it to type a new number works),
 * the setting gets the number as soon as it's valid (kept between min and max), and when you click away the box
 * shows the number that was saved. With `empty`, clearing the box sets null (like "empty = unlimited").
 */
export function NumberInput<E extends boolean = false>({
  value,
  min,
  max = 1_000_000_000,
  onChange,
  empty,
  ...rest
}: {
  value: number | null;
  min: number;
  max?: number;
  onChange: (v: E extends true ? number | null : number) => void;
  empty?: E;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type">) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const send = onChange as (v: number | null) => void;

  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => {
        setEditing(true);
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") {
          if (empty) send(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) send(clamp(n));
      }}
      onBlur={(e) => {
        setEditing(false);
        // An empty box goes back to the saved number (or stays empty when that's allowed).
        if (text.trim() === "" && !empty) setText(shown);
        else setText(value === null ? "" : String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}
