import { render, screen } from '@testing-library/react';
import App from './App';

// Mock axios so this smoke test verifies rendering without requiring the backend API.
jest.mock('axios', () => ({
  create: () => ({
    defaults: { headers: { common: {} } },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  }),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn()
}));

test('renders fitness dashboard', () => {
  // The top-level app should expose the dashboard label and primary calorie tab.
  render(<App />);
  expect(screen.getByText(/fitness dashboard/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /calories/i })).toBeInTheDocument();
});
