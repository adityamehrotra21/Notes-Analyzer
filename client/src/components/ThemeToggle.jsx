import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';
import SegmentedControl from './SegmentedControl.jsx';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun, iconOnly: true },
  { value: 'dark', label: 'Dark', Icon: Moon, iconOnly: true },
  { value: 'system', label: 'System', Icon: Monitor, iconOnly: true },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return <SegmentedControl label="Theme" options={OPTIONS} value={theme} onChange={setTheme} size="sm" />;
}
