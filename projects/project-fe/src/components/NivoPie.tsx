import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export interface NivoPieSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface NivoPieProps {
  data: NivoPieSlice[];
  innerRadius?: number;
  height?: number | string;
}

export function NivoPie({ data, innerRadius = 0.6, height = 220 }: NivoPieProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={`${Math.round(innerRadius * 48)}%`}
            outerRadius="78%"
            paddingAngle={1.5}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0];
              return (
                <div
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                >
                  <span style={{ color: d.payload.color }}>■ </span>
                  {d.name}: <strong>{d.value}</strong>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
