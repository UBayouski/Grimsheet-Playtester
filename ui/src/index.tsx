// The entry of the built module. The SDK is imported as a namespace, so a missing export cannot fail the link.
import * as sdk from '@kirocrew/app-sdk';
import { createDashboardPage } from './page';

export default createDashboardPage(sdk as unknown as Readonly<Record<string, unknown>>);