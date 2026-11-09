import type { Meta, StoryObj } from "@storybook/react";
import { AppShell, Button, Card, EmptyState, TextField } from "../index.js";

const meta: Meta = { title: "Seed/Library" };
export default meta;

export const Buttons: StoryObj = { render: () => (<div className="clniq-root"><Button>Book visit</Button> <Button variant="secondary">Cancel</Button> <Button disabled>Saving</Button></div>) };
export const Field: StoryObj = { render: () => (<div className="clniq-root"><TextField label="Mobile number" hint="10 digits" /><TextField label="UHID" error="Not found" /></div>) };
export const CardStory: StoryObj = { name: "Card", render: () => (<div className="clniq-root"><Card><h2>Today</h2><p>Queue summary</p></Card></div>) };
export const Empty: StoryObj = { render: () => (<div className="clniq-root"><EmptyState title="No patients yet" action={<Button>Register patient</Button>} /></div>) };
export const Shell: StoryObj = {
  render: () => (
    <AppShell locale="ml" brand={<strong>CLNIQ</strong>} activeKey="visit" nav={[{ key: "patient", label: "Patients", href: "#" }, { key: "visit", label: "Queue", href: "#" }]}>
      <EmptyState title="Queue is clear" />
    </AppShell>
  )
};
