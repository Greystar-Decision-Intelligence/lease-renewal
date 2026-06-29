import { residents } from '@/lib/data';
import { Dashboard } from '@/components/Dashboard';

export default function HomePage() {
  return <Dashboard residents={residents} />;
}
