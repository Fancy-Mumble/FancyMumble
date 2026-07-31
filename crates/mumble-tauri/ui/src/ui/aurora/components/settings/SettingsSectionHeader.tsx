export interface SettingsSectionHeaderProps {
  title: string;
  description: string;
}

export default function SettingsSectionHeader({ title, description }: SettingsSectionHeaderProps) {
  return (
    <>
      <h3>{title}</h3>
      <p>{description}</p>
    </>
  );
}
