import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../tabs';

const TabsTestComponent = () => {
  return (
    <Tabs defaultValue="tab1" data-testid="tabs">
      <TabsList>
        <TabsTrigger value="tab1">Tab One</TabsTrigger>
        <TabsTrigger value="tab2">Tab Two</TabsTrigger>
        <TabsTrigger value="tab3" disabled>
          Disabled Tab
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tab1" data-testid="tab1-content">
        <p>Content for Tab One</p>
      </TabsContent>
      <TabsContent value="tab2" data-testid="tab2-content">
        <p>Content for Tab Two</p>
      </TabsContent>
      <TabsContent value="tab3" data-testid="tab3-content">
        <p>Content for Disabled Tab</p>
      </TabsContent>
    </Tabs>
  );
};

describe('Tabs component', () => {
  it('renders tabs with trigger buttons', () => {
    render(<TabsTestComponent />);
    expect(screen.getByRole('tab', { name: 'Tab One' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab Two' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Disabled Tab' })).toBeInTheDocument();
  });

  it('shows first tab content by default', () => {
    render(<TabsTestComponent />);
    expect(screen.getByTestId('tab1-content')).toBeInTheDocument();
    expect(screen.getByText('Content for Tab One')).toBeInTheDocument();
  });

  it('switches content when tab is clicked', () => {
    render(<TabsTestComponent />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab Two' }));
    expect(screen.getByTestId('tab2-content')).toBeInTheDocument();
    expect(screen.getByText('Content for Tab Two')).toBeInTheDocument();
  });

  it('does not switch to disabled tab', () => {
    render(<TabsTestComponent />);
    const disabledTab = screen.getByRole('tab', { name: 'Disabled Tab' });
    expect(disabledTab).toBeDisabled();
    fireEvent.click(disabledTab);
    expect(screen.getByTestId('tab1-content')).toBeInTheDocument();
  });

  it('renders all tab content in DOM (hidden until activated)', () => {
    render(<TabsTestComponent />);
    expect(screen.getByTestId('tab1-content')).toBeInTheDocument();
    expect(screen.getByTestId('tab2-content')).toBeInTheDocument();
    expect(screen.getByTestId('tab3-content')).toBeInTheDocument();
  });

  it('has correct aria-selected for active tab', () => {
    render(<TabsTestComponent />);
    const tabOne = screen.getByRole('tab', { name: 'Tab One' });
    const tabTwo = screen.getByRole('tab', { name: 'Tab Two' });
    expect(tabOne).toHaveAttribute('aria-selected', 'true');
    expect(tabTwo).toHaveAttribute('aria-selected', 'false');
  });
});
