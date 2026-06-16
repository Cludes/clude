import click

from clude import __version__
from clude.commands.env import env
from clude.commands.fleet import fleet
from clude.commands.log import log


@click.group()
@click.version_option(__version__, prog_name="clude")
def main() -> None:
    """clude - developer workspace CLI.

    \b
    Commands:
      env     Audit and manage environment variables
      fleet   Health-check and report on multiple repositories
      log     View git activity across all repositories
    """


main.add_command(env)
main.add_command(fleet)
main.add_command(log)
