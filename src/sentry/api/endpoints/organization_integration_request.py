from __future__ import absolute_import

from django.core.urlresolvers import reverse

from rest_framework.response import Response

from sentry import integrations
from sentry.api.bases.organization import OrganizationEndpoint
from sentry.api.bases import OrganizationPermission
from sentry.plugins.base import plugins
from sentry.models import SentryApp
from sentry.utils.email import MessageBuilder
from sentry.utils.http import absolute_uri


class OrganizationIntegrationRequestPermission(OrganizationPermission):
    scope_map = {
        "POST": ["org:read"],
    }


def get_url(organization, provider_type, provider_slug):
    return absolute_uri(
        u"/".join([
            u"/settings",
            organization.slug,
            {
                "sentryapp": "sentry-apps",
                "plugin": "plugins",
                "integration": "integrations",
            }.get(provider_type),
            provider_slug,
        ])
    )


def get_provider_name(provider_type, provider_slug):
    """
    The things that users think of as "integrations" are actually three
    different things: integrations, plugins, and sentryapps. A user requesting
    than an integration be installed only actually knows the "provider" they
    want and not what type they want. This function looks up the display name
    for the integration they want installed.

    :param provider_type: One of: "integrations", "plugins", or "sentryapps".
    :param provider_slug: The unique identifier for the provider.
    :return: The display name for the provider.

    :raises: ValueError if provider_type is not one of the three from above.
    :raises: Exception if the provider is not found.
    """
    if provider_type == "sentry_app":
        sentry_app = SentryApp.objects.get(slug=provider_slug)
        if not sentry_app:
            raise Exception("Provider {} not found".format(provider_slug))
        return sentry_app.name

    elif provider_type == "first_party":
        try:
            return integrations.get(provider_slug).name
        except KeyError:
            raise Exception("Provider {} not found".format(provider_slug))

    elif provider_type == "plugin":
        try:
            return plugins.get(provider_slug).title
        except KeyError:
            raise Exception("Provider {} not found".format(provider_slug))
    else:
        raise ValueError("Invalid provider_type")


class OrganizationIntegrationRequestEndpoint(OrganizationEndpoint):
    permission_classes = (OrganizationIntegrationRequestPermission,)

    def post(self, request, organization):
        """
        Email the organization owners asking them to install an integration.
        ````````````````````````````````````````````````````````````````````
        When a non-owner user views integrations in the integrations directory,
        they lack the ability to install them themselves. POSTing to this API
        alerts users with permission that there is demand for this integration.

        :param string provider_slug: Unique string that identifies the integration.
        :param string provider_name: One of: integration, plugin, sentryapp.
        :param string message: Optional message from the requester to the owners.
        """
        provider_type = request.data.get("provider_type")
        provider_slug = request.data.get("provider_slug")
        message_option = request.data.get("message", "").strip()

        try:
            provider_name = get_provider_name(provider_type, provider_slug)
        except Exception as error:
            return Response({"detail": error.message}, status=400)

        # If for some reason the user had permissions all along, silently fail.
        requester = request.user
        if requester.id in [user.id for user in organization.get_owners()]:
            return Response({"detail": "User can install integration"}, status=200)

        msg = MessageBuilder(
            subject="Your team member requested the %s integration on Sentry" % provider_name,
            template="sentry/emails/requests/organization-integration.txt",
            html_template="sentry/emails/requests/organization-integration.html",
            type="organization.integration.request",
            context={
                "integration_link": get_url(organization, provider_type, provider_slug),
                "integration_name": provider_name,
                "message": message_option,
                "organization_name": organization.name,
                "requester_name": requester.name or requester.username,
                "requester_link": absolute_uri(
                    "/settings/{organization_slug}/members/{user_id}/".format(
                        organization_slug=organization.slug,
                        user_id=requester.id,
                    )
                ),
                "settings_link": reverse("sentry-organization-settings", args=[organization.slug])
            },
        )

        msg.send_async([user.email for user in organization.get_owners()])

        return Response(status=201)
