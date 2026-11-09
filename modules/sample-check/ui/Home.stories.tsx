import type { Meta, StoryObj } from "@storybook/react";
import { SampleCheckHome } from "./index.js";

const meta: Meta<typeof SampleCheckHome> = { title: "Modules/Sample Check/Home", component: SampleCheckHome };
export default meta;
export const Empty: StoryObj<typeof SampleCheckHome> = { args: { locale: "en", apiBase: "/", token: async () => "" } };
