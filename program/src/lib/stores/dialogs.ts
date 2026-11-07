/** @file Open / closed state of the app's modal dialogs (a store each, so any component can open them). */
import { writable } from 'svelte/store';

export const helpDialogOpen = writable(false);
