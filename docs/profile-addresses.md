# Student addresses

The private `/profile` editor includes optional permanent and current addresses. Each contains Street / House / Village (including C/O if needed), Post office, Police station and a Bangladesh district dropdown.

Select **Same as permanent address** to copy the permanent address and keep the current address in sync while selected. Clear it to edit the current address separately. Saving stores both address values; reopening the form recognizes matching nonempty addresses.

The API stores these details in `StudentProfile.addresses`, a JSONB column added by `20261105000000_profile_addresses`. Old profiles receive empty address values. The private profile endpoint accepts nested partial patches, preserves omitted fields, trims supplied text, and permits an empty string to clear a field. Street text is limited to 300 characters and post office/police station to 100 each. District must be empty or one of the 64 supported districts.

Addresses do not affect profile completion or publication eligibility. They are excluded from public talent profiles, cards, directory filters, metadata and admin student lists. The existing city field remains the student's public location.

District names follow the [Bangladesh Agro-Meteorological Information Service / Bangladesh Meteorological Department list](https://www.bamis.gov.bd/en/bmd/observed/spi/table/), with the Khagrachhari spelling used by the Directorate General of Health Services.

Before starting the updated API against a database, apply the additive migration with `npm run db:migrate`, then run `npm run generate`. The migration adds one empty-default column and does not overwrite existing profile data.

Run `npm run test:addresses` for address validation, nested partial updates, concurrency, backwards compatibility and public-data privacy regression checks.
