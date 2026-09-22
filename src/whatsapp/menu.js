export class MenuBuilder {
  constructor({ config, settings }) { this.config = config; this.settings = settings; }
  values() { return typeof this.settings === 'function' ? this.settings() : { ...this.config, ...(this.settings || {}) }; }
  main(member) {
    const c = this.values();
    const greeting = member ? `Welcome, ${member.firstName}.` : `Welcome to ${c.churchName}.`;
    return {
      intro: `${greeting}\n\n${c.menuIntro}`,
      footer: c.botFooter,
      sections: [
        { title: 'Membership', rows: [
          { title: '👤 My details', description: 'View your registered details', id: 'member:view' },
          { title: '📝 Register', description: 'Create or complete your membership', id: 'member:register' },
          { title: '✏️ Update details', description: 'Change your name or phone', id: 'member:update' },
          { title: '🆔 My reference', description: 'View and copy your reference code', id: 'member:reference' },
        ] },
        { title: 'Gathering', rows: [
          { title: '🚌 Transport information', description: 'View the travel arrangement', id: 'event:transport' },
          { title: '📍 Event information', description: 'View the current gathering details', id: 'event:details' },
          { title: '🔔 Reminders', description: 'Turn reminders on or off', id: 'member:reminders' },
        ] },
        { title: 'Account', rows: [
          { title: '🗑️ Delete membership', description: 'Remove your membership record', id: 'member:delete' },
          { title: '❓ Help', description: 'How this service works', id: 'help' },
        ] },
      ],
    };
  }
}
