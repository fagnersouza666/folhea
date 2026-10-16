package com.folhea.security;

import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.oidc.OidcRequestContext;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.runtime.CodeAuthenticationMechanism;
import io.quarkus.oidc.runtime.DefaultTenantConfigResolver;
import io.quarkus.oidc.runtime.OidcConfig;
import io.quarkus.oidc.runtime.OidcProvider;
import io.quarkus.oidc.runtime.TenantConfigBean;
import io.quarkus.oidc.runtime.TenantConfigContext;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.spi.runtime.BlockingSecurityExecutor;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.core.http.Cookie;
import io.vertx.core.http.HttpServerRequest;
import io.vertx.core.http.HttpServerResponse;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.spi.BeanManager;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Runs the installed Quarkus refresh lifecycle, including its marker and cookie
 * mutation. Provider I/O, identity verification and HTTP transport are fixtures;
 * blocking tasks execute synchronously, without CDI or an event loop.
 * Reflection deliberately makes an incompatible runtime upgrade fail here.
 */
class OidcRefreshRuntimeContractTest {
    private static final Duration WAIT = Duration.ofSeconds(5);
    private static final String COOKIE = "q_session_contract";
    private static final String ID_TOKEN = fixtureIdToken(
            "{\"sub\":\"fixture\",\"iat\":1792152000,\"exp\":1792152300}");
    private static final String ID_WITHOUT_ISSUED_AT = fixtureIdToken(
            "{\"sub\":\"fixture\",\"exp\":1792152300}");

    // Synthetic JWT-shaped data with an invalid signature, never a provider credential.
    private static String fixtureIdToken(String claims) {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return encoder.encodeToString("{\"alg\":\"RS256\"}".getBytes(StandardCharsets.UTF_8)) + "."
                + encoder.encodeToString(claims.getBytes(StandardCharsets.UTF_8)) + ".fixture";
    }

    @Test
    void runtimeRefreshPreservesTheCookieAndTheStateBetweenDeleteAndCreate() throws Exception {
        Fixture fixture = new Fixture();
        fixture.manager.afterDelete = () -> assertNotNull(fixture.manager.getTokens(
                null, null, fixture.reference, null).await().atMost(WAIT));

        assertSame(fixture.identity, fixture.refresh().await().atMost(WAIT));

        assertEquals(List.of("delete", "create"), fixture.manager.calls);
        assertEquals(fixture.reference, fixture.cookies.get(COOKIE).getValue());
        assertEquals("renewed-access", fixture.manager.getTokens(null, null, fixture.reference, null)
                .await().atMost(WAIT).getAccessToken());
        assertEquals(1, fixture.manager.tokenCount());
    }

    @Test
    void runtimeRefreshCannotRestoreAReferenceRevokedAfterDelete() throws Exception {
        Fixture fixture = new Fixture();
        fixture.manager.afterDelete = () -> fixture.manager.deleteTokens(
                null, null, fixture.reference, null).await().atMost(WAIT);

        assertThrows(AuthenticationFailedException.class, () -> fixture.refresh().await().atMost(WAIT));

        assertEquals(List.of("delete", "create"), fixture.manager.calls);
        assertNull(fixture.manager.getTokens(null, null, fixture.reference, null).await().atMost(WAIT));
        assertEquals(0, fixture.manager.tokenCount());
    }

    @Test
    void failedRefreshCompletionRevokesTheOriginalHandleEvenAfterQuarkusEmptiesTheCookie() throws Exception {
        Fixture fixture = new Fixture(ID_WITHOUT_ISSUED_AT);
        AuthenticationFailedException failure = assertThrows(AuthenticationFailedException.class,
                () -> fixture.refresh().await().atMost(WAIT));
        assertEquals(List.of("delete"), fixture.manager.calls);
        assertEquals("", fixture.cookies.get(COOKIE).getValue());

        // DefaultAuthFailureHandler records the failure before getChallenge;
        // getChallenge uses this same runtime cleanup with the now-empty cookie.
        HttpSecurityUtils.addAuthenticationFailureToEvent(failure, fixture.context);
        Method cleanup = Class.forName("io.quarkus.oidc.runtime.OidcUtils")
                .getDeclaredMethod("removeSessionCookie", RoutingContext.class,
                        OidcTenantConfig.class, io.quarkus.oidc.TokenStateManager.class);
        cleanup.setAccessible(true);
        ((Uni<?>) cleanup.invoke(null, fixture.context, fixture.tenant.oidcConfig(), fixture.manager))
                .await().atMost(WAIT);

        assertEquals(List.of("delete", "delete"), fixture.manager.calls);
        assertNull(fixture.manager.getTokens(null, null, fixture.reference, null).await().atMost(WAIT));
        assertEquals(0, fixture.manager.tokenCount());
    }

    @Test
    void apiFailureAfterRefreshCompletionRevokesThePendingHandleWithoutAChallenge() throws Exception {
        Fixture fixture = new Fixture(ID_WITHOUT_ISSUED_AT);
        AuthenticationFailedException failure = assertThrows(AuthenticationFailedException.class,
                () -> fixture.refresh().await().atMost(WAIT));

        var mapper = mapper(fixture.manager);
        var response = mapper.failedAuthentication(failure, fixture.context).await().atMost(WAIT);

        assertEquals(401, response.getStatus());
        assertNull(response.getHeaderString("Location"));
        assertNull(fixture.manager.getTokens(null, null, fixture.reference, null).await().atMost(WAIT));
        assertNotNull(fixture.manager.removals.thread.get());
        assertNotSame(Thread.currentThread(), fixture.manager.removals.thread.get());
    }

    @Test
    void apiFailureWhileVerifyingRefreshedIdentityRevokesTheIncomingHandleWithoutAChallenge() throws Exception {
        Fixture fixture = new Fixture();
        fixture.rejectIdentity = true;
        AuthenticationFailedException failure = assertThrows(AuthenticationFailedException.class,
                () -> fixture.refresh().await().atMost(WAIT));
        assertTrue(fixture.manager.calls.isEmpty());

        var mapper = mapper(fixture.manager);
        var response = mapper.failedAuthentication(failure, fixture.context).await().atMost(WAIT);

        assertEquals(401, response.getStatus());
        assertNull(response.getHeaderString("Location"));
        assertNull(fixture.manager.getTokens(null, null, fixture.reference, null).await().atMost(WAIT));
        assertNotNull(fixture.manager.removals.thread.get());
        assertNotSame(Thread.currentThread(), fixture.manager.removals.thread.get());
    }

    private static com.folhea.shared.NotAuthorizedExceptionMapper mapper(ServerTokenStateManager manager)
            throws ReflectiveOperationException {
        var mapper = new com.folhea.shared.NotAuthorizedExceptionMapper();
        var tokenStates = com.folhea.shared.NotAuthorizedExceptionMapper.class.getDeclaredField("tokenStates");
        tokenStates.setAccessible(true);
        tokenStates.set(mapper, manager);
        return mapper;
    }

    private static final class Fixture {
        final RecordingManager manager = new RecordingManager();
        final String reference = manager.createTokenState(null, null,
                new AuthorizationCodeTokens(ID_TOKEN, "old-access", "old-refresh"), null).await().atMost(WAIT);
        final Map<String, Cookie> cookies = new HashMap<>();
        final Map<String, Object> data = new HashMap<>();
        final SecurityIdentity identity = proxy(SecurityIdentity.class, (p, m, a) -> defaultValue(m.getReturnType()));
        final RoutingContext context;
        final TenantConfigContext tenant;
        final CodeAuthenticationMechanism mechanism;
        boolean rejectIdentity;

        Fixture() throws Exception {
            this(ID_TOKEN);
        }

        Fixture(String renewedIdToken) throws Exception {
            cookies.put(COOKIE, Cookie.cookie(COOKIE, reference));
            HttpServerRequest request = proxy(HttpServerRequest.class, (p, m, a) -> switch (m.getName()) {
                case "cookieMap" -> cookies;
                case "path" -> "/api/books";
                case "getCookie" -> cookies.get(a[0]);
                default -> defaultValue(m.getReturnType());
            });
            HttpServerResponse response = proxy(HttpServerResponse.class, (p, m, a) -> switch (m.getName()) {
                case "addCookie" -> { Cookie cookie = (Cookie) a[0]; cookies.put(cookie.getName(), cookie); yield p; }
                case "putHeader" -> p;
                default -> defaultValue(m.getReturnType());
            });
            context = proxy(RoutingContext.class, (p, m, a) -> switch (m.getName()) {
                case "request" -> request;
                case "response" -> response;
                case "cookieMap" -> cookies;
                case "getCookie" -> cookies.get(a[0]);
                case "get" -> data.get(a[0]);
                case "put" -> { data.put((String) a[0], a[1]); yield p; }
                case "remove" -> data.remove(a[0]);
                case "data" -> data;
                default -> defaultValue(m.getReturnType());
            });
            // Disabled only for constructing the resolver without opening any
            // provider connection. The refresh lifecycle below is called directly.
            OidcTenantConfig config = OidcTenantConfig.builder().tenantId("contract").tenantEnabled(false)
                    .tokenStateManager().encryptionRequired(false).end().build();
            OidcProvider provider = new OidcProvider(null, config, null) {
                @Override public Uni<AuthorizationCodeTokens> refreshTokens(String refreshToken) {
                    assertEquals("old-refresh", refreshToken);
                    return Uni.createFrom().item(new AuthorizationCodeTokens(renewedIdToken, "renewed-access", "renewed-refresh"));
                }
            };
            tenant = TenantConfigContext.createReady(provider, config).await().atMost(WAIT);
            BlockingSecurityExecutor executor = new BlockingSecurityExecutor() {
                @Override public <T> Uni<T> executeBlocking(java.util.function.Supplier<? extends T> supplier) {
                    return Uni.createFrom().item(supplier);
                }
            };
            DefaultTenantConfigResolver resolver = resolver(config, executor, manager);
            Constructor<CodeAuthenticationMechanism> constructor = CodeAuthenticationMechanism.class
                    .getDeclaredConstructor(BlockingSecurityExecutor.class, DefaultTenantConfigResolver.class,
                            HttpAuthenticationMechanism.class);
            constructor.setAccessible(true);
            mechanism = constructor.newInstance(executor, resolver, null);
            // Let Quarkus discover the incoming cookie itself; do not prepopulate
            // its refresh marker or the manager's private state.
            Method sessionCookie = Class.forName("io.quarkus.oidc.runtime.OidcUtils")
                    .getDeclaredMethod("getSessionCookie", RoutingContext.class, OidcTenantConfig.class);
            sessionCookie.setAccessible(true);
            assertEquals(reference, sessionCookie.invoke(null, context, config));
        }

        @SuppressWarnings("unchecked")
        Uni<SecurityIdentity> refresh() throws Exception {
            IdentityProviderManager identities = proxy(IdentityProviderManager.class, (p, m, a) -> {
                if (m.getName().equals("authenticate")) return rejectIdentity
                        ? Uni.createFrom().failure(new AuthenticationFailedException()) : Uni.createFrom().item(identity);
                throw new AssertionError(m.getName());
            });
            Method refresh = CodeAuthenticationMechanism.class.getDeclaredMethod("refreshSecurityIdentity",
                    TenantConfigContext.class, String.class, String.class, RoutingContext.class,
                    IdentityProviderManager.class, boolean.class, SecurityIdentity.class);
            refresh.setAccessible(true);
            return (Uni<SecurityIdentity>) refresh.invoke(mechanism, tenant, ID_TOKEN,
                    "old-refresh", context, identities, false, null);
        }
    }

    private static DefaultTenantConfigResolver resolver(OidcTenantConfig config,
            BlockingSecurityExecutor executor, ServerTokenStateManager manager) throws Exception {
        OidcConfig oidc = proxy(OidcConfig.class, (p, m, a) -> switch (m.getName()) {
            case "namedTenants" -> Map.of(OidcConfig.DEFAULT_TENANT_KEY, config);
            default -> defaultValue(m.getReturnType());
        });
        Class<?> impl = Class.forName("io.quarkus.oidc.runtime.OidcImpl");
        Constructor<?> implConstructor = impl.getDeclaredConstructor(OidcConfig.class);
        implConstructor.setAccessible(true);
        Constructor<?> beanConstructor = TenantConfigBean.class.getDeclaredConstructors()[0];
        beanConstructor.setAccessible(true);
        TenantConfigBean bean = (TenantConfigBean) beanConstructor.newInstance(
                null, proxy(io.quarkus.tls.TlsConfigurationRegistry.class,
                        (p, m, a) -> java.util.Optional.empty()), implConstructor.newInstance(oidc), false, null);
        Instance<?> noTenantResolver = proxy(Instance.class, (p, m, a) -> defaultValue(m.getReturnType()));
        Constructor<DefaultTenantConfigResolver> constructor = DefaultTenantConfigResolver.class
                .getDeclaredConstructor(BlockingSecurityExecutor.class, BeanManager.class, Instance.class,
                        boolean.class, boolean.class, String.class, TenantConfigBean.class);
        constructor.setAccessible(true);
        DefaultTenantConfigResolver resolver = constructor.newInstance(executor, null, noTenantResolver,
                false, false, "/", bean);
        var managerField = DefaultTenantConfigResolver.class.getDeclaredField("tokenStateManager");
        managerField.setAccessible(true);
        managerField.set(resolver, proxy(Instance.class, (p, m, a) -> m.getName().equals("get")
                ? manager : defaultValue(m.getReturnType())));
        var actionsField = DefaultTenantConfigResolver.class.getDeclaredField("authenticationCompletionActions");
        actionsField.setAccessible(true);
        actionsField.set(resolver, List.of());
        return resolver;
    }

    private static final class RecordingManager extends ServerTokenStateManager {
        final RemovalProbe removals;
        final List<String> calls = new ArrayList<>();
        Runnable afterDelete = () -> { };

        RecordingManager() {
            this(new RemovalProbe());
        }

        private RecordingManager(RemovalProbe removals) {
            super(removals.store);
            this.removals = removals;
        }

        @Override public Uni<Void> deleteTokens(RoutingContext context, OidcTenantConfig config,
                String state, OidcRequestContext<Void> requestContext) {
            if (context == null) return super.deleteTokens(null, config, state, requestContext);
            calls.add("delete");
            // The static Quarkus delete runner resolves CDI. This isolated
            // contract runs synchronously; store operations remain real.
            return super.deleteTokens(context, config, state, null).invoke(afterDelete);
        }

        @Override public Uni<String> createTokenState(RoutingContext context, OidcTenantConfig config,
                AuthorizationCodeTokens tokens, OidcRequestContext<String> requestContext) {
            if (context != null) calls.add("create");
            return super.createTokenState(context, config, tokens, requestContext);
        }
    }

    private static final class RemovalProbe {
        final java.util.concurrent.atomic.AtomicReference<Thread> thread = new java.util.concurrent.atomic.AtomicReference<>();
        final com.folhea.security.store.InMemoryTokenStateStore delegate =
                new com.folhea.security.store.InMemoryTokenStateStore();
        final com.folhea.security.store.TokenStateStore store = proxy(
                com.folhea.security.store.TokenStateStore.class, (p, m, a) -> {
                    if (m.getName().equals("remove")) thread.set(Thread.currentThread());
                    return m.invoke(delegate, a);
                });
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }

    private static Object defaultValue(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == long.class) return 0L;
        if (type == int.class) return 0;
        throw new AssertionError("Unexpected primitive: " + type);
    }
}
