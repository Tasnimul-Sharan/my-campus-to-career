"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  GraduationCap,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  api,
  emptyProfile,
  errorMessage,
  type Education,
  type Profile,
} from "@/lib/api";
import { AppShell, SessionState, useUser } from "./app-shell";
import { Field, Loading, Notice, SubmitButton } from "./ui";
import { ProfilePictureEditor } from "./profile-picture";
import { CareerInterests, publicationRequirements } from "./career-interests";
import { TALENT_AVAILABILITIES, TALENT_CATEGORIES } from "@/lib/talent";
import { FamilyBackgroundSection } from "./family-background";
import { AcademicGradeFields } from "./academic-grade";
import { OnlinePresenceSection } from "./online-presence";
import { AddressDetailsSection } from "./address-details";
import { normalizeProfileAddresses } from "@/lib/addresses";

function normalize(profile: Partial<Profile>): Profile {
  const result = {
    ...emptyProfile,
    ...profile,
    skills: profile.skills || [],
    addresses: normalizeProfileAddresses(profile.addresses),
    socialLinks: { ...profile.socialLinks, additional: Array.isArray(profile.socialLinks?.additional) ? profile.socialLinks.additional.map(link => ({ label: link.label || "", url: link.url || "" })) : [] },
    cgpa: profile.cgpa ?? null,
    cgpaScale: profile.cgpaScale === 5 ? 5 as const : 4 as const,
    educations: (profile.educations || []).map(entry => ({ ...entry, cgpa: entry.cgpa ?? null, cgpaScale: entry.cgpaScale === 5 ? 5 as const : 4 as const })),
    familyBackground: {
      ...emptyProfile.familyBackground,
      ...profile.familyBackground,
    },
  };
  for (const key of [
    "phone",
    "city",
    "objective",
    "university",
    "department",
    "semester",
    "degree",
    "activities",
    "headline",
  ] as const)
    result[key] = result[key] || "";
  for (const key of [
    "fatherName",
    "fatherOccupation",
    "motherName",
    "motherOccupation",
    "guardianName",
    "guardianRelationship",
    "religion",
    "additionalInformation",
  ] as const)
    result.familyBackground[key] = result.familyBackground[key] || "";
  result.familyBackground.siblings ??= null;
  const knownCategories = Array.isArray(profile.talentCategories) ? [...new Set(profile.talentCategories.filter(value => TALENT_CATEGORIES.some(category => category.slug === value)))].slice(0, 3) : [];
  result.talentCategories = knownCategories.length ? knownCategories : TALENT_CATEGORIES.some(category => category.slug === profile.talentCategory) ? [profile.talentCategory as Profile["talentCategories"][number]] : [];
  result.talentCategory = result.talentCategories[0] || "";
  result.availability = TALENT_AVAILABILITIES.some(
    (availability) => availability.value === profile.availability,
  )
    ? profile.availability!
    : "OPEN_TO_OPPORTUNITIES";
  result.directoryPublished = profile.directoryPublished === true;
  return result;
}

function preserveNewEdits(
  current: Profile,
  submitted: Profile,
  saved: Profile,
): Profile {
  const result = { ...saved };
  for (const key of Object.keys(saved) as (keyof Profile)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(submitted[key]))
      Object.assign(result, { [key]: current[key] });
  }
  return result;
}

export function ProfileEditor() {
  const session = useUser();
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [skill, setSkill] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");
  const [reload, setReload] = useState(0);
  const [pictureAvailable, setPictureAvailable] = useState(false);
  const [savedDirectoryPublished, setSavedDirectoryPublished] = useState(false);
  const editVersion = useRef(0);
  const userId = session.user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setLoadError("");
    api<{ profile: Profile; profilePictureAvailable: boolean }>("/profile")
      .then(({ profile: data, profilePictureAvailable }) => {
        if (!cancelled) {
          const loaded = normalize(data);
          setProfile(loaded);
          setSavedDirectoryPublished(loaded.directoryPublished);
          setPictureAvailable(profilePictureAvailable === true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reload]);
  function change<K extends keyof Profile>(key: K, value: Profile[K]) {
    editVersion.current++;
    setProfile((current) => key === "talentCategories"
      ? { ...current, talentCategories: value as Profile["talentCategories"], talentCategory: (value as Profile["talentCategories"])[0] || "" }
      : { ...current, [key]: value });
    setSuccess("");
  }
  function addSkill() {
    const value = skill.trim();
    if (!value) return;
    if (value.length > 60) {
      setError("A skill name must be 60 characters or fewer.");
      return;
    }
    if (profile.skills.length >= 20) {
      setError("You can add up to 20 skills.");
      return;
    }
    if (!profile.skills.some((s) => s.toLowerCase() === value.toLowerCase()))
      change("skills", [...profile.skills, value]);
    setSkill("");
  }
  function updateEducation(index: number, key: keyof Education, value: string) {
    change(
      "educations",
      profile.educations.map((entry, i) =>
        i === index
          ? {
              ...entry,
              [key]:
                key === "startYear" || key === "endYear"
                  ? value
                    ? Number(value)
                    : undefined
                  : value,
            }
          : entry,
      ),
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const submittedProfile = profile,
      submittedSkill = skill,
      submittedVersion = editVersion.current;
    let next = profile;
    if (
      skill.trim() &&
      !profile.skills.some(
        (s) => s.toLowerCase() === skill.trim().toLowerCase(),
      )
    ) {
      if (profile.skills.length >= 20 || skill.trim().length > 60) {
        setError(
          "The skill limit has been exceeded. Use up to 20 skills, with no more than 60 characters per skill.",
        );
        setSaving(false);
        return;
      }
      next = { ...profile, skills: [...profile.skills, skill.trim()] };
    }
    if (next.talentCategories.length < 1 || next.talentCategories.length > 3) {
      setError("Choose at least one and no more than three primary career categories before saving your profile.");
      setSaving(false);
      return;
    }
    const invalidEducation = next.educations.some(
      (e) => e.startYear && e.endYear && e.startYear > e.endYear,
    );
    if (invalidEducation) {
      setError("The education start year cannot be later than the end year.");
      setSaving(false);
      return;
    }
    const invalidGrade = (grade: number | null | undefined, scale: number | undefined) => grade != null && (!Number.isFinite(grade) || grade < 0 || grade > (scale || 4) || Math.abs(grade * 100 - Math.round(grade * 100)) > 0.000001);
    if (invalidGrade(next.cgpa, next.cgpaScale) || next.educations.some(entry => invalidGrade(entry.cgpa, entry.cgpaScale))) {
      setError("Enter a CGPA between 0 and its selected scale, using up to two decimal places, or leave it blank.");
      setSaving(false);
      return;
    }
    const requirements = publicationRequirements(
      next,
      session.user?.emailVerified === true,
    );
    if (next.directoryPublished && requirements.length > 0) {
      setError(
        `To publish your profile: ${requirements.map((requirement) => requirement.label).join(" ")} You can turn off publishing to save an unfinished profile privately.`,
      );
      setSaving(false);
      return;
    }
    try {
      const data = await api<{ profile?: Profile }>("/profile", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      const saved = normalize(data.profile || next);
      setProfile((current) =>
        preserveNewEdits(current, submittedProfile, saved),
      );
      setSavedDirectoryPublished(saved.directoryPublished);
      setSkill((current) => (current === submittedSkill ? "" : current));
      setSuccess(
        editVersion.current === submittedVersion
          ? "Your profile has been saved successfully."
          : "Your submitted changes have been saved. Save again to keep your newer edits.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  if (!session.user) return <SessionState {...session} />;
  const user = session.user;
  const profileInput = (
    key: "phone" | "city" | "university" | "department" | "semester" | "degree",
    label: string,
    placeholder: string,
    maxLength = 150,
  ) => (
    <Field id={key} label={label}>
      <input
        id={key}
        value={profile[key]}
        onChange={(event) => change(key, event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        type={key === "phone" ? "tel" : "text"}
        autoComplete={
          key === "phone" ? "tel" : key === "city" ? "address-level2" : "off"
        }
      />
    </Field>
  );
  return (
    <AppShell user={user}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TELL YOUR OWN STORY</span>
          <h1>My profile</h1>
          <p>Show who you are through your education, skills and experience.</p>
        </div>
        <Link href="/dashboard" className="text-link">
          <ArrowLeft size={17} /> Dashboard
        </Link>
      </div>
      {loading ? (
        <Loading text="Loading your profile…" />
      ) : (
        loadError && <Notice>{loadError}</Notice>
      )}
      {!loading && !loadError && (
        <ProfilePictureEditor
          user={user}
          available={pictureAvailable}
          onUserChange={session.updateUser}
        />
      )}
      {!loading && !loadError && (
        <form onSubmit={save} className="profile-form" aria-busy={saving}>
          <div className="profile-form-main">
            <section className="panel form-section" id="personal">
              <div className="form-section-heading">
                <span className="section-icon">
                  <UserRound size={22} />
                </span>
                <div>
                  <h2>Personal details</h2>
                  <p>Your account and contact information.</p>
                </div>
                <span className="section-index">01</span>
              </div>
              <div className="form-grid">
                <Field id="accountName" label="Full name">
                  <input
                    id="accountName"
                    value={user.name}
                    readOnly
                    className="readonly-input"
                  />
                </Field>
                <Field id="accountEmail" label="Email">
                  <input
                    id="accountEmail"
                    value={user.email}
                    readOnly
                    className="readonly-input"
                  />
                </Field>
                {profileInput("phone", "Phone number", "e.g. 017XXXXXXXX", 30)}
                {profileInput("city", "City", "Your current city", 100)}
                <Field
                  id="objective"
                  label="Career objective"
                  className="full-width"
                  help="Briefly describe your interests, what you want to learn and your career goals."
                >
                  <textarea
                    id="objective"
                    value={profile.objective}
                    onChange={(event) =>
                      change("objective", event.target.value)
                    }
                    placeholder="Tell us about your future goals…"
                    rows={4}
                    maxLength={1000}
                  />
                </Field>
              </div>
            </section>
            <AddressDetailsSection
              value={profile.addresses}
              onChange={(value) => change("addresses", value)}
            />
            <FamilyBackgroundSection
              value={profile.familyBackground}
              onChange={(value) => change("familyBackground", value)}
            />
            <section className="panel form-section" id="education">
              <div className="form-section-heading">
                <span className="section-icon">
                  <GraduationCap size={22} />
                </span>
                <div>
                  <h2>Education details</h2>
                  <p>Your university and academic background.</p>
                </div>
                <span className="section-index">04</span>
              </div>
              <div className="form-grid">
                {profileInput(
                  "university",
                  "University / Institution",
                  "Your university name",
                  150,
                )}
                {profileInput(
                  "department",
                  "Department / Subject",
                  "e.g. Computer Science",
                  100,
                )}
                {profileInput("degree", "Degree", "e.g. BSc", 100)}
                {/* {profileInput(
                  "semester",
                  "Semester / Year",
                  "e.g. First semester",
                  30,
                )} */}
                <Field id="passingYear" label="Passing year">
                  <input
                    id="passingYear"
                    type="number"
                    min="1950"
                    max="2100"
                    inputMode="numeric"
                    placeholder="e.g. 2028"
                    value={profile.passingYear || ""}
                    onChange={(event) =>
                      change(
                        "passingYear",
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  />
                </Field>
                <AcademicGradeFields id="primary" cgpa={profile.cgpa} scale={profile.cgpaScale} onChange={(cgpa, cgpaScale) => { editVersion.current++; setProfile(current => ({ ...current, cgpa, cgpaScale })); setSuccess(""); }} />
              </div>
              <div className="additional-education">
                <div className="subsection-heading">
                  <h3>Additional qualifications</h3>
                  <button
                    type="button"
                    className="text-link"
                    disabled={profile.educations.length >= 10}
                    onClick={() =>
                      change("educations", [
                        ...profile.educations,
                        { institution: "", degree: "", field: "", cgpa: null, cgpaScale: 4 },
                      ])
                    }
                  >
                    <Plus size={17} /> Add
                  </button>
                </div>
                {profile.educations.length === 0 && (
                  <p className="field-help">
                    You can add previous degrees or other academic
                    qualifications.
                  </p>
                )}
                {profile.educations.map((entry, index) => (
                  <div className="education-entry" key={index}>
                    <div className="education-entry-heading">
                      <strong>
                        Qualification {(index + 1).toLocaleString("en-GB")}
                      </strong>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() =>
                          change(
                            "educations",
                            profile.educations.filter((_, i) => i !== index),
                          )
                        }
                        aria-label={`Remove qualification ${(index + 1).toLocaleString("en-GB")}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <div className="form-grid">
                      {(["institution", "degree", "field"] as const).map(
                        (key) => (
                          <Field
                            key={key}
                            id={`education-${index}-${key}`}
                            label={
                              key === "institution"
                                ? "Institution"
                                : key === "degree"
                                  ? "Degree"
                                  : "Field of study"
                            }
                          >
                            <input
                              id={`education-${index}-${key}`}
                              value={entry[key]}
                              onChange={(event) =>
                                updateEducation(index, key, event.target.value)
                              }
                              required={key !== "field"}
                              maxLength={key === "institution" ? 150 : 100}
                            />
                          </Field>
                        ),
                      )}
                      <AcademicGradeFields id={`education-${index}`} cgpa={entry.cgpa ?? null} scale={entry.cgpaScale === 5 ? 5 : 4} onChange={(cgpa, cgpaScale) => change("educations", profile.educations.map((education, i) => i === index ? { ...education, cgpa, cgpaScale } : education))} />
                      <div className="year-grid">
                        {(["startYear", "endYear"] as const).map((key) => (
                          <Field
                            key={key}
                            id={`education-${index}-${key}`}
                            label={
                              key === "startYear" ? "Start year" : "End year"
                            }
                          >
                            <input
                              id={`education-${index}-${key}`}
                              type="number"
                              min="1950"
                              max="2100"
                              value={entry[key] || ""}
                              onChange={(event) =>
                                updateEducation(index, key, event.target.value)
                              }
                            />
                          </Field>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel form-section" id="skills">
              <div className="form-section-heading">
                <span className="section-icon">
                  <Sparkles size={22} />
                </span>
                <div>
                  <h2>Skills and activities</h2>
                  <p>What you can do and how you get involved on campus.</p>
                </div>
                <span className="section-index">05</span>
              </div>
              <Field
                id="skill"
                label="Skills"
                help="Add one skill at a time. You can include up to 20 skills."
              >
                <div className="skill-input">
                  <input
                    id="skill"
                    value={skill}
                    maxLength={60}
                    onChange={(event) => setSkill(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSkill();
                      }
                    }}
                    placeholder="e.g. Excel, Public speaking"
                  />
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={addSkill}
                    disabled={!skill.trim()}
                  >
                    <Plus size={18} /> Add
                  </button>
                </div>
              </Field>
              <div className="editable-skills">
                {profile.skills.map((value) => (
                  <span className="skill-chip" key={value}>
                    {value}
                    <button
                      type="button"
                      onClick={() =>
                        change(
                          "skills",
                          profile.skills.filter((s) => s !== value),
                        )
                      }
                      aria-label={`Remove ${value}`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
              <Field
                id="activities"
                label="Extracurricular activities"
                help="Describe your clubs, volunteering, competitions or other campus activities."
              >
                <textarea
                  id="activities"
                  value={profile.activities}
                  onChange={(event) => change("activities", event.target.value)}
                  rows={4}
                  placeholder="Tell us about your campus experience…"
                  maxLength={2000}
                />
              </Field>
            </section>
            <OnlinePresenceSection value={profile.socialLinks} onChange={value => change("socialLinks", value)} />
            <CareerInterests
              profile={profile}
              userId={user.id}
              emailVerified={user.emailVerified}
              savedDirectoryPublished={savedDirectoryPublished}
              onChange={change}
            />
            <div className="profile-save-bar">
              {error && <Notice>{error}</Notice>}
              {success && <Notice success>{success}</Notice>}
              <div>
                <p>
                  <Check size={17} /> Your details will be saved to your account
                  profile.
                </p>
                <SubmitButton busy={saving}>
                  {saving ? "Saving…" : "Save profile"}
                  {!saving && <Save size={18} />}
                </SubmitButton>
              </div>
            </div>
          </div>
          <aside className="profile-guide">
            <div className="panel">
              <span className="eyebrow">A LITTLE ABOUT YOU</span>
              <h3>
                Your story,
                <br />
                in your own words.
              </h3>
              <p>
                You can complete your profile over time. Start with the details
                you have.
              </p>
              <nav aria-label="Profile sections">
                <a href="#personal">
                  01 <span>Personal details</span>
                </a>
                <a href="#addresses">
                  02 <span>Address details</span>
                </a>
                <a href="#family">
                  03 <span>Family background</span>
                </a>
                <a href="#education">
                  04 <span>Education details</span>
                </a>
                <a href="#skills">
                  05 <span>Skills and activities</span>
                </a>
                <a href="#links">
                  06 <span>Online presence</span>
                </a>
                <a href="#career-interests">
                  07 <span>Career interests</span>
                </a>
              </nav>
            </div>
            <div className="profile-tip">
              <Sparkles size={23} />
              <strong>A quick tip</strong>
              <p>
                Include a specific interest and goal in your career objective.
                You can update it as your plans develop.
              </p>
            </div>
          </aside>
        </form>
      )}
      {!loading && loadError && (
        <button
          className="button button-outline retry-profile"
          type="button"
          onClick={() => setReload((v) => v + 1)}
        >
          Reload profile
        </button>
      )}
    </AppShell>
  );
}
