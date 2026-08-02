import { localePath, type Locale } from '../i18n/config';
import * as m from '../paraglide/messages.js';

export type Project = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  href: string;
  external?: boolean;
  accent: 'cyan' | 'violet' | 'amber';
};

export function getProjects(locale: Locale): Project[] {
  return [
    {
      id: 'featured-project',
      eyebrow: m.project_featured_eyebrow({}, { locale }),
      title: m.project_featured_title({}, { locale }),
      description: m.project_featured_description({}, { locale }),
      status: m.project_status({}, { locale }),
      tags: [
        m.project_tag_technology({}, { locale }),
        m.project_tag_role({}, { locale }),
        m.project_tag_timeline({}, { locale }),
      ],
      href: `${localePath(locale, '/projects/')}#featured-project`,
      accent: 'cyan',
    },
    {
      id: 'long-term-project',
      eyebrow: m.project_long_term_eyebrow({}, { locale }),
      title: m.project_long_term_title({}, { locale }),
      description: m.project_long_term_description({}, { locale }),
      status: m.project_status({}, { locale }),
      tags: [
        m.project_tag_domain({}, { locale }),
        m.project_tag_technology({}, { locale }),
        m.project_tag_output({}, { locale }),
      ],
      href: `${localePath(locale, '/projects/')}#long-term-project`,
      accent: 'violet',
    },
    {
      id: 'experimental-project',
      eyebrow: m.project_experiment_eyebrow({}, { locale }),
      title: m.project_experiment_title({}, { locale }),
      description: m.project_experiment_description({}, { locale }),
      status: m.project_status({}, { locale }),
      tags: [
        m.project_tag_type({}, { locale }),
        m.project_tag_technology({}, { locale }),
        m.project_tag_stage({}, { locale }),
      ],
      href: `${localePath(locale, '/projects/')}#experimental-project`,
      accent: 'amber',
    },
  ];
}
