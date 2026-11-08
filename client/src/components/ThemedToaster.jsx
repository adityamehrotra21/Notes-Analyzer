import { Toaster } from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext.jsx';

// react-hot-toast styles with inline styles, so colours are passed per theme here.
const STYLES = {
  light: { background: '#ffffff', color: '#18181b', border: '1px solid #e4e4e7' },
  dark: { background: '#18181b', color: '#f4f4f5', border: '1px solid #3f3f46' },
};

export default function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: { ...STYLES[resolvedTheme], fontSize: '0.875rem', borderRadius: '0.75rem', boxShadow: 'none' },
      }}
    />
  );
}
