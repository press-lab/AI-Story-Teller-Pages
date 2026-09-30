export interface TabDefinition<T extends string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  tabs: TabDefinition<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
}

export function Tabs<T extends string>({ tabs, activeTab, onChange }: TabsProps<T>) {
  return (
    <nav className="tabs" aria-label="Main sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === activeTab ? "active" : ""}
          type="button"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
