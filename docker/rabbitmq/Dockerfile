FROM rabbitmq:3-management-alpine

USER root

RUN mkdir -p /var/lib/rabbitmq && \
    chown -R rabbitmq:rabbitmq /var/lib/rabbitmq && \
    chmod 700 /var/lib/rabbitmq

USER rabbitmq