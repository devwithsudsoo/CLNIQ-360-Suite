import type { Meta, StoryObj } from "@storybook/react";
import { __PASCAL__Home } from "./index.js";

const meta: Meta<typeof __PASCAL__Home> = { title: "Modules/__NAME__/Home", component: __PASCAL__Home };
export default meta;
export const Empty: StoryObj<typeof __PASCAL__Home> = { args: { locale: "en", apiBase: "/", token: async () => "" } };
