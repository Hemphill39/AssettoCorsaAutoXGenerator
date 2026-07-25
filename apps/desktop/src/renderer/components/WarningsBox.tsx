interface WarningsBoxProps {
  title?: string;
  warnings: string[];
}

/** Surfaces non-fatal notes without sounding like an error dialog. */
export function WarningsBox({ title = "Worth knowing", warnings }: WarningsBoxProps): JSX.Element | null {
  if (warnings.length === 0) return null;
  return (
    <div className="notice-box">
      <div className="notice-box-title">{title}</div>
      <ul>
        {warnings.map((warning, i) => (
          <li key={i}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
