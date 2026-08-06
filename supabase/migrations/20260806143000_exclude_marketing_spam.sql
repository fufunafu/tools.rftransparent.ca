-- Close unmistakable SEO and marketing solicitations without deleting them.
-- Quoted, won, and lost records are deliberately left untouched.

update leads
set
  outcome = 'not_applicable',
  not_applicable_reason = 'Spam: marketing solicitation',
  updated_at = now()
where source = 'website'
  and outcome in ('new', 'contacted', 'not_applicable')
  and coalesce(message, '') ~* (
    'search engine optimi[sz]ation'
    || '|(rank|ranking|first page|top page|position).{0,40}(google|search engine)'
    || '|(google|search engine).{0,40}(rank|ranking|first page|top page|position)'
    || '|backlinks?'
    || '|link[ -]?building'
    || '|domain authority'
    || '|(guest|sponsored) posts?'
    || '|publish (an? )?article'
  );
