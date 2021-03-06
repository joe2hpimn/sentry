import React from 'react';
import {Location} from 'history';
import * as ReactRouter from 'react-router';
import styled from '@emotion/styled';
import isEqual from 'lodash/isEqual';

import {Client} from 'app/api';
import {t} from 'app/locale';
import {GlobalSelection, Organization, Project} from 'app/types';
import {loadOrganizationTags} from 'app/actionCreators/tags';
import FeatureBadge from 'app/components/featureBadge';
import SearchBar from 'app/views/events/searchBar';
import SentryDocumentTitle from 'app/components/sentryDocumentTitle';
import GlobalSelectionHeader from 'app/components/organizations/globalSelectionHeader';
import {ALL_ACCESS_PROJECTS} from 'app/constants/globalSelectionHeader';
import {PageContent} from 'app/styles/organization';
import LightWeightNoProjectMessage from 'app/components/lightWeightNoProjectMessage';
import Alert from 'app/components/alert';
import EventView from 'app/utils/discover/eventView';
import space from 'app/styles/space';
import Button from 'app/components/button';
import ButtonBar from 'app/components/buttonBar';
import {decodeScalar} from 'app/utils/queryString';
import {trackAnalyticsEvent} from 'app/utils/analytics';
import withApi from 'app/utils/withApi';
import withGlobalSelection from 'app/utils/withGlobalSelection';
import withOrganization from 'app/utils/withOrganization';
import withProjects from 'app/utils/withProjects';
import {tokenizeSearch, stringifyQueryObject} from 'app/utils/tokenizeSearch';

import {generatePerformanceEventView, DEFAULT_STATS_PERIOD} from './data';
import Table from './table';
import Charts from './charts/index';
import Onboarding from './onboarding';

enum FilterViews {
  ALL_TRANSACTIONS = 'ALL_TRANSACTIONS',
  KEY_TRANSACTIONS = 'KEY_TRANSACTIONS',
}

const VIEWS = Object.values(FilterViews);

type Props = {
  api: Client;
  organization: Organization;
  selection: GlobalSelection;
  location: Location;
  router: ReactRouter.InjectedRouter;
  projects: Project[];
  loadingProjects: boolean;
};

type State = {
  eventView: EventView;
  error: string | undefined;
  currentView: FilterViews;
};

class PerformanceLanding extends React.Component<Props, State> {
  static getDerivedStateFromProps(nextProps: Props, prevState: State): State {
    return {...prevState, eventView: generatePerformanceEventView(nextProps.location)};
  }

  state: State = {
    eventView: generatePerformanceEventView(this.props.location),
    error: undefined,
    currentView: FilterViews.ALL_TRANSACTIONS,
  };

  componentDidMount() {
    const {api, organization, selection} = this.props;
    loadOrganizationTags(api, organization.slug, selection);
  }

  componentDidUpdate(prevProps: Props) {
    const {api, organization, selection} = this.props;
    if (
      !isEqual(prevProps.selection.projects, selection.projects) ||
      !isEqual(prevProps.selection.datetime, selection.datetime)
    ) {
      loadOrganizationTags(api, organization.slug, selection);
    }
  }

  renderError() {
    const {error} = this.state;

    if (!error) {
      return null;
    }

    return (
      <Alert type="error" icon="icon-circle-exclamation">
        {error}
      </Alert>
    );
  }

  setError = (error: string | undefined) => {
    this.setState({error});
  };

  handleSearch = (searchQuery: string) => {
    const {location, organization} = this.props;

    trackAnalyticsEvent({
      eventKey: 'performance_views.overview.search',
      eventName: 'Performance Views: Transaction overview search',
      organization_id: parseInt(organization.id, 10),
    });

    ReactRouter.browserHistory.push({
      pathname: location.pathname,
      query: {
        ...location.query,
        cursor: undefined,
        query: String(searchQuery).trim() || undefined,
      },
    });
  };

  getViewLabel(currentView: FilterViews): string {
    switch (currentView) {
      case FilterViews.ALL_TRANSACTIONS:
        return t('All Transactions');
      case FilterViews.KEY_TRANSACTIONS:
        return t('My Key Transactions');
      default:
        throw Error(`Unknown view: ${currentView}`);
    }
  }

  getTransactionSearchQuery() {
    const {location} = this.props;

    return String(decodeScalar(location.query.query) || '').trim();
  }

  /**
   * Generate conditions to foward to the summary views.
   *
   * We drop the bare text string as in this view we apply it to
   * the transaction name, and that condition is redundant in the
   * summary view.
   */
  getSummaryConditions(query: string) {
    const parsed = tokenizeSearch(query);
    parsed.query = [];

    return stringifyQueryObject(parsed);
  }

  renderHeaderButtons() {
    const selectView = (viewKey: FilterViews) => {
      return () => {
        this.setState({
          currentView: viewKey,
        });
      };
    };

    return (
      <ButtonBar merged active={this.state.currentView}>
        {VIEWS.map(viewKey => {
          return (
            <Button
              key={viewKey}
              barId={viewKey}
              size="small"
              onClick={selectView(viewKey)}
            >
              {this.getViewLabel(viewKey)}
            </Button>
          );
        })}
      </ButtonBar>
    );
  }

  shouldShowOnboarding() {
    const {projects} = this.props;
    const {eventView} = this.state;

    if (projects.length === 0) {
      return false;
    }

    // Current selection is 'my projects' or 'all projects'
    if (eventView.project.length === 0 || eventView.project === [ALL_ACCESS_PROJECTS]) {
      return (
        projects.filter(p => p.firstTransactionEvent === false).length === projects.length
      );
    }

    // Any other subset of projects.
    return (
      projects.filter(
        p =>
          eventView.project.includes(parseInt(p.id, 10)) &&
          p.firstTransactionEvent === false
      ).length === eventView.project.length
    );
  }

  render() {
    const {organization, location, router, projects} = this.props;
    const {eventView} = this.state;
    const showOnboarding = this.shouldShowOnboarding();
    const filterString = this.getTransactionSearchQuery();
    const summaryConditions = this.getSummaryConditions(filterString);

    return (
      <SentryDocumentTitle title={t('Performance')} objSlug={organization.slug}>
        <GlobalSelectionHeader
          defaultSelection={{
            datetime: {
              start: null,
              end: null,
              utc: false,
              period: DEFAULT_STATS_PERIOD,
            },
          }}
        >
          <PageContent>
            <LightWeightNoProjectMessage organization={organization}>
              <StyledPageHeader>
                <div>
                  {t('Performance')} <FeatureBadge type="beta" />
                </div>
                {!showOnboarding && <div>{this.renderHeaderButtons()}</div>}
              </StyledPageHeader>
              {this.renderError()}
              {showOnboarding ? (
                <Onboarding />
              ) : (
                <div>
                  <StyledSearchBar
                    organization={organization}
                    projectIds={eventView.project}
                    location={location}
                    query={filterString}
                    fields={eventView.fields}
                    onSearch={this.handleSearch}
                  />
                  <Charts
                    eventView={eventView}
                    organization={organization}
                    location={location}
                    router={router}
                    keyTransactions={this.state.currentView === 'KEY_TRANSACTIONS'}
                  />
                  <Table
                    eventView={eventView}
                    projects={projects}
                    organization={organization}
                    location={location}
                    setError={this.setError}
                    keyTransactions={this.state.currentView === 'KEY_TRANSACTIONS'}
                    summaryConditions={summaryConditions}
                  />
                </div>
              )}
            </LightWeightNoProjectMessage>
          </PageContent>
        </GlobalSelectionHeader>
      </SentryDocumentTitle>
    );
  }
}

export const StyledPageHeader = styled('div')`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: ${p => p.theme.headerFontSize};
  color: ${p => p.theme.gray700};
  height: 40px;
  margin-bottom: ${space(1)};
`;

const StyledSearchBar = styled(SearchBar)`
  flex-grow: 1;

  margin-bottom: ${space(2)};
`;

export default withApi(
  withOrganization(withProjects(withGlobalSelection(PerformanceLanding)))
);
